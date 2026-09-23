'use strict';

/**
 * server.js — Express API backed by MySQL (via Prisma) and Google OAuth.
 *
 * Storage backend: MySQL, accessed exclusively through a shared Prisma
 * Client instance (lib/prisma.js). Connection info comes solely from the
 * DATABASE_URL environment variable — see prisma/schema.prisma. There is no
 * in-memory or SQLite fallback: a fresh MySQL instance is made schema-ready
 * by running `prisma migrate deploy` at container startup (see Dockerfile),
 * which applies the single migration checked into prisma/migrations/.
 *
 * Authentication: Google OAuth 2.0 via passport + passport-google-oauth20.
 * A successful OAuth round-trip upserts a User row (keyed by Google's
 * stable `sub` id) and establishes an HttpOnly session cookie
 * (express-session) so the login survives page reloads. Pong has no
 * username/password login of its own — there is no password column on
 * User and this app never touches bcrypt — Google Sign-In is the only way
 * to establish an identity that high scores and preferences can hang off.
 *
 * Data model (see prisma/schema.prisma)
 * ──────────────────────────────────────
 *   User        Google `sub` id (primary key), email, display name, avatar,
 *               lastPlayedAt (bumped on every POST /api/scores call,
 *               regardless of whether that game also set a new best).
 *   Preference  One row per user (FK → User.id): theme / sound / paddle
 *               color settings.
 *   HighScore   One row per user (FK → User.id): that user's personal best
 *               score, plus `longestRally` — that same player's longest-ever
 *               rally (consecutive paddle hits without a miss), an
 *               independent running best bumped in the same write whenever
 *               it's exceeded, regardless of whether `score` also improved.
 *   GameHistory One row per finished game (FK → User.id): score, duration,
 *               finishedAt. Independent of HighScore — written alongside it
 *               on every game-completion, never read by it.
 *
 * Endpoints
 * ─────────
 *   GET  /auth/google           Redirect to the Google consent screen.
 *   GET  /auth/google/callback  OAuth callback — exchanges code for profile,
 *                                upserts the User row, establishes the
 *                                session.
 *   GET  /auth/logout           Destroy the session (logout).
 *   GET  /me                    Returns the logged-in user (or { user: null }).
 *
 *   GET    /api/preferences      Returns the logged-in user's preferences
 *                                 (defaults if none have been saved yet).
 *   PUT    /api/preferences      Create or update the logged-in user's
 *                                 preferences.
 *
 *   GET    /api/scores           List high scores (sorted desc by score).
 *   POST   /api/scores           Create or update the logged-in user's high
 *                                 score. Requires an authenticated Google
 *                                 session — every HighScore row is tied to a
 *                                 User by foreign key, so there is no way to
 *                                 record a score for an anonymous player.
 *                                 Also records a GameHistory row for this
 *                                 finished game (see below) — the two tables
 *                                 are written independently of one another.
 *   GET    /api/scores/:userId   Get the high score for a specific user id.
 *   DELETE /api/scores/:userId   Delete the high score for a specific user id.
 *
 *   GET    /api/game-history      Returns the logged-in user's 10 most
 *                                 recent finished games (newest first).
 *                                 Requires an authenticated Google session.
 *
 *   GET  /health                 Basic health check (200 OK).
 *
 *   POST /api/events              Reports a declared experiment event (see
 *                                 mendel-metrics.js) fired by the in-canvas
 *                                 settings menu / game loop, e.g.
 *                                 { type: 'customization_changed' }.
 *   POST /api/client-events      Fire-and-forget pings for browser-only
 *                                 events (game-over shown, Play Again
 *                                 clicked, a page reload after game-over,
 *                                 a page visit, a new game starting),
 *                                 counted via telemetry.js. No other effect.
 *                                 A successful Google sign-in (see
 *                                 /auth/google/callback) is separately
 *                                 counted server-side via telemetry.js.
 *
 * The module exports { createApp, defaultPrisma } — createApp accepts any
 * Prisma-Client-shaped object, so unit tests can inject a lightweight fake
 * instead of talking to a real MySQL instance.
 */

const express        = require('express');
const path           = require('path');
const crypto         = require('crypto');
const session        = require('express-session');
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { mendelMiddleware, incr, DECLARED_METRICS } = require('./mendel-metrics');
const telemetry      = require('./telemetry');
const defaultPrisma  = require('./lib/prisma');

// ── App factory ────────────────────────────────────────────────────────────
//
// Accepting a `prisma` parameter makes every endpoint independently
// testable against a lightweight fake instead of a real MySQL instance.
//
// `options.testAuth`, if provided, is a middleware inserted right after
// passport's session middleware that can set `req.user` directly — a
// testing seam only, so unit tests can exercise the login-gated routes
// (POST /api/scores, /api/preferences) without a real Google OAuth
// round-trip or hand-signing session cookies. Production startup (below)
// never passes it.

function createApp(prisma = defaultPrisma, options = {}) {
  const app = express();

  // Trust the first proxy hop (Fly.io's edge, or any other TLS-terminating
  // reverse proxy in front of this process). Without this, Express derives
  // req.protocol from the raw (plaintext) connection it receives — which is
  // always "http" once the proxy has terminated TLS — instead of honouring
  // the X-Forwarded-Proto header the proxy sets. That mismatch is exactly
  // what causes Google's "redirect_uri_mismatch": passport-oauth2 builds the
  // callback URL it sends to Google from req.protocol + req.get('host'), so
  // an untrusted proxy silently downgrades the redirect_uri from
  // "https://…/auth/google/callback" to "http://…/auth/google/callback",
  // which no longer matches the URI registered in Google Cloud Console.
  app.set('trust proxy', 1);

  // ── Live-traffic experiment instrumentation ──────────────────────────────
  //
  // Isolated OpenTelemetry metrics for the 'game-customization-options' hop
  // (see mendel-metrics.js). No-ops entirely — no cookies set, nothing
  // exported, nothing logged — when MENDEL_METRICS_ENDPOINT / _TOKEN /
  // MENDEL_EXPERIMENT_ID are not configured.
  app.use(mendelMiddleware);

  app.use(express.json());

  // ── Session middleware (HttpOnly cookie, in-memory store) ────────────────
  //
  // Sessions themselves stay in-process (express-session's default
  // MemoryStore) — only durable data (users, preferences, high scores) lives
  // in MySQL. SESSION_SECRET should be set in production; if it isn't, a
  // random secret is generated per-process, so sessions simply won't survive
  // a restart.

  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Only require HTTPS-only cookies when explicitly running in production
      // behind TLS; keeps local http:// development working out of the box.
      secure:   process.env.COOKIE_SECURE === 'true',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  if (typeof options.testAuth === 'function') {
    app.use(options.testAuth);
  }

  // ── Experiment telemetry (isolated OpenTelemetry metrics) ────────────────
  //
  // Counts requests / participants / declared events for the live
  // control-vs-variation comparison. Entirely inert when the MENDEL_METRICS_*
  // / MENDEL_EXPERIMENT_ID environment variables aren't configured.
  app.use(telemetry.middleware);

  // ── Google OAuth (passport) ──────────────────────────────────────────────

  /**
   * Upsert a User row keyed by Google's stable `sub` id (mapped to
   * `profile.id` by passport-google-oauth20). Fields Google didn't return
   * this time (e.g. avatar on a re-login where the scope changed) fall back
   * to whatever is already stored rather than being blanked out.
   */
  async function upsertGoogleUser(profile) {
    const id     = profile.id;
    const email  = (profile.emails && profile.emails[0] && profile.emails[0].value) || null;
    const name   = profile.displayName || null;
    const avatar = (profile.photos && profile.photos[0] && profile.photos[0].value) || null;

    const updateData = {};
    if (email)  updateData.email  = email;
    if (name)   updateData.name   = name;
    if (avatar) updateData.avatar = avatar;

    return prisma.user.upsert({
      where:  { id },
      update: updateData,
      create: { id, email, name, avatar },
    });
  }

  passport.serializeUser((user, done) => done(null, user.id));

  // ── Best-rally display bucketing ─────────────────────────────────────────
  //
  // The "Best rally" readout under the canvas (see index.html) is only shown
  // to a deterministic 50% of signed-in players — a lightweight built-in
  // feature gate, unrelated to the separate live-traffic experiment
  // telemetry in telemetry.js. Hashing the player's stable Google `sub` id
  // (rather than flipping a coin per request) means the same player always
  // lands in the same bucket, on every device and every session, with no
  // extra column or cookie required.

  function isBestRallyBucketed(userId) {
    if (!userId) return false;
    const digest = crypto.createHash('sha256').update(String(userId)).digest();
    return digest[0] % 2 === 0; // ~50/50 split, stable per user id
  }

  passport.deserializeUser((id, done) => {
    prisma.user.findUnique({ where: { id } })
      .then((user) => done(null, user || false))
      .catch((err) => done(err));
  });

  // GOOGLE_CALLBACK_URL may be:
  //   - left unset, in which case it defaults to the relative path below and
  //     is resolved by passport-oauth2 against the incoming request's
  //     protocol + host (correct now that 'trust proxy' is set above); or
  //   - set explicitly to a fully-qualified URL (recommended in production),
  //     e.g. "https://pong-game-0e30d7df.fly.dev/auth/google/callback" — this
  //     MUST exactly match (scheme, host, path) an "Authorized redirect URI"
  //     registered for the OAuth client in Google Cloud Console, or Google
  //     will reject the request with "Error 400: redirect_uri_mismatch".
  const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_CALLBACK_URL  = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';
  const googleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

  // Only register the strategy when credentials are present so the app can
  // still boot (e.g. in tests, or before the operator has configured OAuth).
  if (googleOAuthConfigured) {
    passport.use(new GoogleStrategy(
      {
        clientID:     GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL:  GOOGLE_CALLBACK_URL,
      },
      (accessToken, refreshToken, profile, done) => {
        upsertGoogleUser(profile)
          .then((user) => done(null, user))
          .catch((err) => done(err));
      },
    ));
  }

  // Serve the static Pong game at the root
  app.use(express.static(path.join(__dirname)));

  // ── GET /health ───────────────────────────────────────────────────────────

  app.get('/health', (req, res) => {
    return res.status(200).json({ status: 'ok' });
  });

  // ── POST /api/events ──────────────────────────────────────────────────────
  //
  // Lets the in-canvas game report a declared experiment event (see
  // mendel-metrics.js DECLARED_METRICS) — e.g. the player changed a
  // customization option, or a match reached game-over. Always responds
  // 204 regardless of whether metrics reporting is enabled, so the client
  // never has to branch on it.

  const DECLARED_EVENT_NAMES = new Set(DECLARED_METRICS.map((m) => m.name));

  app.post('/api/events', (req, res) => {
    const type = req.body && req.body.type;
    if (typeof type === 'string' && DECLARED_EVENT_NAMES.has(type)) {
      incr(type, res.locals.mendelAttrs);
    }
    return res.status(204).end();
  });

  // ── POST /api/client-events ───────────────────────────────────────────────
  //
  // Fire-and-forget pings from the client for the handful of events that can
  // only be observed in the browser (the game-over screen being shown,
  // 'Play Again' being triggered, a full page reload while it was showing).
  // Only known event names are counted (via the experiment telemetry); the
  // endpoint has no other side effect and always responds 204.

  app.post('/api/client-events', (req, res) => {
    const eventName = req.body && req.body.event;
    telemetry.recordClientEvent(eventName, req);
    return res.status(204).end();
  });

  // ── GET /auth/google ──────────────────────────────────────────────────────
  //
  // Kicks off the OAuth flow by redirecting to Google's consent screen.

  app.get('/auth/google', (req, res, next) => {
    if (!googleOAuthConfigured) {
      return res.status(503).json({ error: 'Google OAuth is not configured on this server' });
    }
    return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  // ── GET /auth/google/callback ─────────────────────────────────────────────
  //
  // Exchanges the authorization code for a profile, upserts the User row,
  // and establishes the session before redirecting back to the app.

  app.get('/auth/google/callback', (req, res, next) => {
    if (!googleOAuthConfigured) {
      return res.status(503).json({ error: 'Google OAuth is not configured on this server' });
    }
    return passport.authenticate('google', { failureRedirect: '/?login=failed' })(req, res, () => {
      telemetry.recordUserLogin(req);
      res.redirect('/');
    });
  });

  // ── GET /auth/logout ──────────────────────────────────────────────────────
  //
  // Destroys the session and clears the session cookie.

  app.get('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
      });
    });
  });

  // ── GET /me ────────────────────────────────────────────────────────────────
  //
  // Returns the logged-in user (id / email / name / avatar) or { user: null }.
  // Also returns `bestRallyBucket` — whether this signed-in player is in the
  // ~50% shown the "Best rally" readout after game-over (see
  // isBestRallyBucketed above); always false when signed out.

  app.get('/me', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const { id, email, name, avatar } = req.user;
      return res.status(200).json({
        user: { id, email, name, avatar },
        bestRallyBucket: isBestRallyBucketed(id),
      });
    }
    return res.status(200).json({ user: null, bestRallyBucket: false });
  });

  // ── Auth guard helper ────────────────────────────────────────────────────

  function requireLogin(req, res) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      return true;
    }
    res.status(401).json({ error: 'login required' });
    return false;
  }

  // ── GET /api/preferences ─────────────────────────────────────────────────
  //
  // Returns the logged-in user's saved preferences, or the schema defaults
  // if none have been saved yet.

  app.get('/api/preferences', async (req, res, next) => {
    if (!requireLogin(req, res)) return;

    try {
      const pref = await prisma.preference.findUnique({ where: { userId: req.user.id } });
      return res.status(200).json({
        preferences: pref || { theme: 'dark', soundEnabled: true, paddleColor: '#ffffff' },
      });
    } catch (err) {
      return next(err);
    }
  });

  // ── PUT /api/preferences ─────────────────────────────────────────────────
  //
  // Create or update the logged-in user's preferences.
  // Body: { theme?: string, soundEnabled?: boolean, paddleColor?: string }

  app.put('/api/preferences', async (req, res, next) => {
    if (!requireLogin(req, res)) return;

    const body = req.body || {};
    const data = {};

    if (body.theme !== undefined) {
      if (typeof body.theme !== 'string' || body.theme.trim() === '') {
        return res.status(400).json({ error: 'theme must be a non-empty string' });
      }
      data.theme = body.theme.trim();
    }

    if (body.soundEnabled !== undefined) {
      if (typeof body.soundEnabled !== 'boolean') {
        return res.status(400).json({ error: 'soundEnabled must be a boolean' });
      }
      data.soundEnabled = body.soundEnabled;
    }

    if (body.paddleColor !== undefined) {
      if (typeof body.paddleColor !== 'string' || body.paddleColor.trim() === '') {
        return res.status(400).json({ error: 'paddleColor must be a non-empty string' });
      }
      data.paddleColor = body.paddleColor.trim();
    }

    try {
      const pref = await prisma.preference.upsert({
        where:  { userId: req.user.id },
        update: data,
        create: { userId: req.user.id, ...data },
      });
      return res.status(200).json({ preferences: pref });
    } catch (err) {
      return next(err);
    }
  });

  // ── GET /api/scores ───────────────────────────────────────────────────────
  //
  // Returns high scores sorted by score descending.
  // Optional query param: ?limit=N  (max 100)

  app.get('/api/scores', async (req, res, next) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 100);

    try {
      const rows = await prisma.highScore.findMany({
        orderBy: { score: 'desc' },
        take:    limit,
        include: { user: true },
      });

      const scores = rows.map(toScoreEntry);
      return res.status(200).json({ scores });
    } catch (err) {
      return next(err);
    }
  });

  // ── POST /api/scores ──────────────────────────────────────────────────────
  //
  // Create or update (upsert) the logged-in user's high score. Only updates
  // `score` if the new score is strictly higher than the stored one, and
  // only updates `longestRally` if the new value is strictly higher than the
  // stored one — the two are independent running bests, both written by a
  // single upsert call whenever either improves. Requires an authenticated
  // Google session — HighScore.userId is a foreign key to User.id, so there
  // is no such thing as an anonymous high score.
  //
  // Every call also inserts a GameHistory row for this finished game,
  // regardless of whether it beat the high score — HighScore and GameHistory
  // are independent tables; this endpoint is simply the one place a finished
  // game is reported, so both writes happen here, side by side.
  //
  // Body: { score: number, duration?: number, longestRally?: number }
  //   duration     - game length in seconds (non-negative integer); defaults
  //                  to 0 when omitted so older clients keep working.
  //   longestRally - longest rally (consecutive paddle hits) reached during
  //                  this game (non-negative integer); defaults to 0 when
  //                  omitted so older clients keep working.

  app.post('/api/scores', async (req, res, next) => {
    if (!requireLogin(req, res)) return;

    const score = req.body && req.body.score;

    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      return res.status(400).json({ error: 'score must be a non-negative finite number' });
    }

    let duration = req.body && req.body.duration;
    if (duration === undefined || duration === null) {
      duration = 0;
    } else if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      return res.status(400).json({ error: 'duration must be a non-negative finite number' });
    }
    duration = Math.round(duration);

    let longestRally = req.body && req.body.longestRally;
    if (longestRally === undefined || longestRally === null) {
      longestRally = 0;
    } else if (typeof longestRally !== 'number' || !Number.isInteger(longestRally) || longestRally < 0) {
      return res.status(400).json({ error: 'longestRally must be a non-negative integer' });
    }

    try {
      const userId  = req.user.id;
      const existing = await prisma.highScore.findUnique({ where: { userId } });

      // GameHistory is written unconditionally — independent of whether this
      // score beats the existing HighScore row.
      await prisma.gameHistory.create({ data: { userId, score, duration } });

      // User.lastPlayedAt is bumped unconditionally on every finished game,
      // regardless of whether this game also set a new best — independent
      // of the conditional HighScore upsert below.
      await prisma.user.update({ where: { id: userId }, data: { lastPlayedAt: new Date() } });

      const existingLongestRally = existing ? (existing.longestRally || 0) : 0;
      const scoreImproved  = !existing || score > existing.score;
      const rallyImproved  = longestRally > existingLongestRally;

      if (!scoreImproved && !rallyImproved) {
        return res.status(200).json({ updated: false, entry: toScoreEntry({ ...existing, user: req.user }) });
      }

      const row = await prisma.highScore.upsert({
        where:  { userId },
        update: {
          score:        scoreImproved ? score : existing.score,
          longestRally: rallyImproved ? longestRally : existingLongestRally,
        },
        create: { userId, score, longestRally },
      });

      return res.status(200).json({ updated: scoreImproved, entry: toScoreEntry({ ...row, user: req.user }) });
    } catch (err) {
      return next(err);
    }
  });

  // ── GET /api/scores/:userId ───────────────────────────────────────────────
  //
  // Retrieve the high score for a specific user id (Google `sub`).

  app.get('/api/scores/:userId', async (req, res, next) => {
    try {
      const row = await prisma.highScore.findUnique({
        where:   { userId: req.params.userId },
        include: { user: true },
      });

      if (!row) {
        return res.status(404).json({ error: 'player not found' });
      }

      return res.status(200).json({ entry: toScoreEntry(row) });
    } catch (err) {
      return next(err);
    }
  });

  // ── DELETE /api/scores/:userId ────────────────────────────────────────────
  //
  // Remove the high score entry for the given user id.

  app.delete('/api/scores/:userId', async (req, res, next) => {
    try {
      await prisma.highScore.delete({ where: { userId: req.params.userId } });
      return res.status(200).json({ deleted: true, userId: req.params.userId });
    } catch (err) {
      // Prisma throws P2025 ("Record to delete does not exist") on a miss.
      if (err && err.code === 'P2025') {
        return res.status(404).json({ error: 'player not found' });
      }
      return next(err);
    }
  });

  // ── GET /api/game-history ─────────────────────────────────────────────────
  //
  // Returns the logged-in user's 10 most recently finished games, newest
  // first. Requires an authenticated Google session — GameHistory has no
  // notion of an anonymous player.

  app.get('/api/game-history', async (req, res, next) => {
    if (!requireLogin(req, res)) return;

    try {
      const rows = await prisma.gameHistory.findMany({
        where:   { userId: req.user.id },
        orderBy: { finishedAt: 'desc' },
        take:    10,
      });

      const games = rows.map(toGameHistoryEntry);
      return res.status(200).json({ games });
    } catch (err) {
      return next(err);
    }
  });

  return app;
}

/**
 * Shapes a HighScore row (optionally with an included/attached `user`) into
 * the { player, score, longestRally, updatedAt, lastPlayedAt } entry the API
 * returns — `player` is the best available human-readable identity (name,
 * then email, then the raw Google id). `longestRally` defaults to 0 for rows
 * written before that column existed. `lastPlayedAt` is the attached user's
 * User.lastPlayedAt (see server.js's POST /api/scores) — null for users who
 * haven't finished a game since that column existed, or when no `user` was
 * included in the query.
 */
function toScoreEntry(row) {
  const user   = row.user || {};
  const player = user.name || user.email || row.userId;
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt;
  const lastPlayedAt = user.lastPlayedAt instanceof Date
    ? user.lastPlayedAt.getTime()
    : (user.lastPlayedAt || null);
  return {
    player,
    userId: row.userId,
    score: row.score,
    longestRally: row.longestRally || 0,
    updatedAt,
    lastPlayedAt,
  };
}

/**
 * Shapes a GameHistory row into the { score, duration, finishedAt } entry
 * returned by GET /api/game-history.
 */
function toGameHistoryEntry(row) {
  const finishedAt = row.finishedAt instanceof Date ? row.finishedAt.getTime() : row.finishedAt;
  return { id: row.id, score: row.score, duration: row.duration, finishedAt };
}

// ── Start server (when run directly) ──────────────────────────────────────

if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  const HOST = '0.0.0.0';
  const app  = createApp(defaultPrisma);

  app.listen(PORT, HOST, () => {
    console.log(`Pong server listening on ${HOST}:${PORT}`);
    console.log('Storage: MySQL via Prisma (DATABASE_URL)');
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.log('Google OAuth: NOT configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to enable)');
    } else {
      console.log('Google OAuth: configured');
    }
  });
}

module.exports = { createApp, defaultPrisma };
