'use strict';

/**
 * server.js — Express API backed by MySQL (via Knex) and Google OAuth.
 *
 * Storage backend: MySQL, accessed exclusively through the thin query
 * functions in db/queries.js, which in turn use the single Knex client in
 * db/knex.js. The MySQL connection string is read purely from
 * process.env.DATABASE_URL (see knexfile.js) — there is nothing else to
 * configure. On startup (see the bottom of this file) the server calls
 * knex.migrate.latest() before it starts listening, so migrations in
 * ./migrations apply automatically against any fresh managed MySQL
 * instance. DATABASE_URL isn't required for the process itself to start,
 * though: if it's unset, or the migration fails because the database isn't
 * reachable yet, the server logs that and starts listening anyway (so
 * /health still comes up) — only the MySQL-backed routes are affected
 * until a working DATABASE_URL is configured.
 *
 * Authentication: Google OAuth 2.0 via passport + passport-google-oauth20.
 * A successful OAuth round-trip finds-or-creates a user row (keyed by
 * Google's stable `sub` id) via db/queries.js and establishes an HttpOnly
 * session cookie (express-session, in-memory store) so the login survives
 * page reloads for the lifetime of the session cookie. There is no
 * password column anywhere in the schema and no bcrypt in this codebase:
 * authentication is delegated entirely to Google.
 *
 * Requires registering the app in Google Cloud Console and setting
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (and optionally an explicit
 * GOOGLE_CALLBACK_URL) environment variables. When deploying behind a
 * TLS-terminating proxy, the app must trust that proxy's
 * X-Forwarded-Proto header — otherwise the callback URL passport builds for
 * the OAuth redirect is silently downgraded to "http://…", which no longer
 * matches the "https://…" URI registered in Google Cloud Console and Google
 * rejects the request with "Error 400: redirect_uri_mismatch".
 *
 * Endpoints
 * ─────────
 *   GET  /auth/google           Redirect to the Google consent screen.
 *   GET  /auth/google/callback  OAuth callback — exchanges code for profile,
 *                                finds-or-creates the user, starts the session.
 *   GET  /auth/logout           Destroy the session (logout).
 *   GET  /me                    Returns the logged-in user (or { user: null }).
 *
 *   POST /api/login              Legacy stub login — accepts any username,
 *                                 returns a session token (kept for backward
 *                                 compatibility with earlier variations; this
 *                                 token is not persisted to MySQL).
 *   GET  /api/scores             List all high scores (sorted desc by score).
 *   POST /api/scores             Create or update a high score entry. If the
 *                                 caller has an authenticated Google session
 *                                 and no `player` is supplied, the player is
 *                                 derived from the logged-in user's identity.
 *   GET  /api/scores/:player     Get the high score for a specific player.
 *   DELETE /api/scores/:player   Delete the high score for a specific player.
 *
 *   GET  /api/preferences/:key   Get a preference for the logged-in user.
 *   POST /api/preferences        Set (upsert) a preference for the logged-in
 *                                 user. Body: { key: string, value: string }.
 *
 *   GET  /health                 Basic health check (200 OK).
 *
 *   POST /api/client-events      Fire-and-forget pings for browser-only
 *                                 events (game-over shown, Play Again
 *                                 clicked, a page reload after game-over),
 *                                 counted via telemetry.js. No other effect.
 *
 * The module exports { createApp } so unit tests can inject their own
 * `queries` implementation (see __tests__/helpers/fakeQueries.js) and
 * exercise every route without a real MySQL connection.
 */

const express        = require('express');
const path           = require('path');
const crypto         = require('crypto');
const session        = require('express-session');
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const telemetry      = require('./telemetry');
const defaultQueries = require('./db/queries');

// ── App factory ────────────────────────────────────────────────────────────
//
// Accepting a `queries` parameter (defaulting to the real Knex-backed
// implementation) makes every endpoint independently testable against an
// in-memory fake without touching MySQL.

function createApp(queries = defaultQueries) {
  const app = express();

  // Trust the first proxy hop (e.g. a TLS-terminating reverse proxy in
  // front of this process). Without this, Express derives req.protocol
  // from the raw (plaintext) connection it receives — which is always
  // "http" once the proxy has terminated TLS — instead of honouring the
  // X-Forwarded-Proto header the proxy sets. That mismatch is exactly what
  // causes Google's "redirect_uri_mismatch": passport-oauth2 builds the
  // callback URL it sends to Google from req.protocol + req.get('host'),
  // so an untrusted proxy silently downgrades the redirect_uri from
  // "https://…/auth/google/callback" to "http://…/auth/google/callback",
  // which no longer matches the URI registered in Google Cloud Console.
  app.set('trust proxy', 1);

  app.use(express.json());

  // ── Legacy stub-login tokens ─────────────────────────────────────────────
  //
  // POST /api/login (kept for backward compatibility) hands out a random
  // token per call. These tokens are never looked up anywhere else in this
  // app and are intentionally NOT part of the MySQL schema — they live only
  // for the lifetime of this app instance, same as before.
  const legacySessions = new Map();

  // ── Session middleware (HttpOnly cookie, in-memory store) ────────────────
  //
  // SESSION_SECRET should be set in production. If it isn't, a random secret
  // is generated per-process — sessions simply won't survive a restart.

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

  // ── Experiment telemetry (isolated OpenTelemetry metrics) ────────────────
  //
  // Counts requests / participants / declared events for the live
  // control-vs-variation comparison. Entirely inert when the MENDEL_METRICS_*
  // / MENDEL_EXPERIMENT_ID environment variables aren't configured.
  app.use(telemetry.middleware);

  // ── Google OAuth (passport) ──────────────────────────────────────────────

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser((id, done) => {
    queries.getUserById(id)
      .then((user) => done(null, user || false))
      .catch((err) => done(err));
  });

  // GOOGLE_CALLBACK_URL may be:
  //   - left unset, in which case it defaults to the relative path below and
  //     is resolved by passport-oauth2 against the incoming request's
  //     protocol + host (correct now that 'trust proxy' is set above); or
  //   - set explicitly to a fully-qualified URL (recommended in production),
  //     e.g. "https://example.com/auth/google/callback" — this MUST exactly
  //     match (scheme, host, path) an "Authorized redirect URI" registered
  //     for the OAuth client in Google Cloud Console, or Google will reject
  //     the request with "Error 400: redirect_uri_mismatch".
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
        const googleId = profile.id;
        const email     = (profile.emails && profile.emails[0] && profile.emails[0].value) || null;
        const name      = profile.displayName || null;
        const avatar    = (profile.photos && profile.photos[0] && profile.photos[0].value) || null;

        queries.findOrCreateUserByGoogleId({ googleId, email, name, avatar })
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
  // Exchanges the authorization code for a profile, finds-or-creates the
  // user row, and establishes the session before redirecting back to the app.

  app.get('/auth/google/callback', (req, res, next) => {
    if (!googleOAuthConfigured) {
      return res.status(503).json({ error: 'Google OAuth is not configured on this server' });
    }
    return passport.authenticate('google', { failureRedirect: '/?login=failed' })(req, res, () => {
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

  app.get('/me', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const { id, email, name, avatar_url } = req.user;
      return res.status(200).json({ user: { id, email, name, avatar: avatar_url } });
    }
    return res.status(200).json({ user: null });
  });

  // ── POST /api/login ──────────────────────────────────────────────────────
  //
  // Legacy stub authentication (kept for backward compatibility): any
  // non-empty username is accepted and returns a random session token.

  app.post('/api/login', (req, res) => {
    const { username } = req.body || {};

    if (!username || typeof username !== 'string' || username.trim() === '') {
      return res.status(400).json({ error: 'username is required' });
    }

    const player = username.trim().toLowerCase();
    const token  = crypto.randomBytes(16).toString('hex');
    legacySessions.set(token, { username: player, createdAt: Date.now() });

    return res.status(200).json({ token, username: player });
  });

  // ── GET /api/scores ───────────────────────────────────────────────────────
  //
  // Returns all stored high scores sorted by score descending.
  // Optional query param: ?limit=N  (max 100)

  app.get('/api/scores', async (req, res, next) => {
    try {
      const limit   = Math.min(parseInt(req.query.limit, 10) || 100, 100);
      const entries = await queries.listHighScores(limit);
      return res.status(200).json({ scores: entries });
    } catch (err) {
      return next(err);
    }
  });

  // ── POST /api/scores ──────────────────────────────────────────────────────
  //
  // Create or update (upsert) a high score for the given player.
  // Only updates if the new score is strictly higher than the stored one.
  // Body: { player?: string, score: number }
  //
  // If `player` is omitted and the request carries an authenticated Google
  // OAuth session (see /auth/google), the player identity is derived from
  // the logged-in user (email, then name, then Google id) — this is what
  // the 'Save Score' button in the UI relies on.

  app.post('/api/scores', async (req, res, next) => {
    try {
      const body  = req.body || {};
      const score = body.score;
      let player  = body.player;

      const hasExplicitPlayer = typeof player === 'string' && player.trim() !== '';
      const authed = Boolean(req.isAuthenticated && req.isAuthenticated() && req.user);

      if (!hasExplicitPlayer && authed) {
        player = req.user.email || req.user.name || String(req.user.id);
      }

      if (!player || typeof player !== 'string' || player.trim() === '') {
        return res.status(400).json({ error: 'player is required' });
      }

      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
        return res.status(400).json({ error: 'score must be a non-negative finite number' });
      }

      const key    = player.trim().toLowerCase();
      const userId = authed ? req.user.id : null;

      const { updated, entry } = await queries.upsertHighScore(key, score, userId);
      return res.status(200).json({ updated, entry });
    } catch (err) {
      return next(err);
    }
  });

  // ── GET /api/scores/:player ───────────────────────────────────────────────
  //
  // Retrieve the high score for a specific player.

  app.get('/api/scores/:player', async (req, res, next) => {
    try {
      const key   = req.params.player.trim().toLowerCase();
      const entry = await queries.getHighScore(key);

      if (!entry) {
        return res.status(404).json({ error: 'player not found' });
      }

      return res.status(200).json({ entry });
    } catch (err) {
      return next(err);
    }
  });

  // ── DELETE /api/scores/:player ────────────────────────────────────────────
  //
  // Remove the high score entry for the given player.

  app.delete('/api/scores/:player', async (req, res, next) => {
    try {
      const key     = req.params.player.trim().toLowerCase();
      const deleted = await queries.deleteHighScore(key);

      if (!deleted) {
        return res.status(404).json({ error: 'player not found' });
      }

      return res.status(200).json({ deleted: true, player: key });
    } catch (err) {
      return next(err);
    }
  });

  // ── GET /api/preferences/:key ─────────────────────────────────────────────
  //
  // Returns { key, value } for the logged-in user's preference, or 404 if
  // it has never been set. Requires an authenticated Google session.

  app.get('/api/preferences/:key', async (req, res, next) => {
    try {
      if (!(req.isAuthenticated && req.isAuthenticated() && req.user)) {
        return res.status(401).json({ error: 'authentication required' });
      }

      const value = await queries.getPreference(req.user.id, req.params.key);

      if (value === null) {
        return res.status(404).json({ error: 'preference not found' });
      }

      return res.status(200).json({ key: req.params.key, value });
    } catch (err) {
      return next(err);
    }
  });

  // ── POST /api/preferences ─────────────────────────────────────────────────
  //
  // Create or update (upsert) a preference for the logged-in user.
  // Body: { key: string, value: string }. Requires an authenticated Google
  // session.

  app.post('/api/preferences', async (req, res, next) => {
    try {
      if (!(req.isAuthenticated && req.isAuthenticated() && req.user)) {
        return res.status(401).json({ error: 'authentication required' });
      }

      const { key, value } = req.body || {};

      if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: 'key is required' });
      }

      const pref = await queries.setPreference(req.user.id, key, value == null ? null : String(value));
      return res.status(200).json(pref);
    } catch (err) {
      return next(err);
    }
  });

  // ── Error handler ──────────────────────────────────────────────────────────
  //
  // Catches errors passed via next(err) from the async route handlers above
  // (e.g. a MySQL connection failure) so a single query problem returns a
  // clean 500 instead of crashing the process.

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    return res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

// ── Start server (when run directly) ──────────────────────────────────────

if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  const HOST = '0.0.0.0';
  const app  = createApp();

  function startListening() {
    app.listen(PORT, HOST, () => {
      console.log(`Pong server listening on ${HOST}:${PORT}`);
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        console.log('Google OAuth: NOT configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to enable)');
      } else {
        console.log('Google OAuth: configured');
      }
    });
  }

  // Apply any pending migrations before accepting traffic, so a fresh
  // managed MySQL instance is always brought up to the current schema
  // (see ./migrations) without a separate manual step. DATABASE_URL isn't
  // required for the process to boot, though: mirroring the optional
  // Google OAuth wiring above, a missing/unreachable database only
  // disables the MySQL-backed routes (they'll return a 500 if actually
  // called) rather than crashing the whole server — that keeps `node
  // server.js` startable (e.g. for health checks, or in environments that
  // haven't provisioned a database yet) instead of exiting non-zero the
  // moment DATABASE_URL isn't set to a reachable MySQL instance.
  if (!process.env.DATABASE_URL) {
    console.log('Storage: MySQL via Knex — DATABASE_URL is not set, skipping migrations');
    console.log('  (routes that touch the database will fail until DATABASE_URL is configured)');
    startListening();
  } else {
    const knex = require('./db/knex');
    knex.migrate.latest()
      .then(() => {
        console.log('Storage: MySQL via Knex (DATABASE_URL) — migrations applied');
        startListening();
      })
      .catch((err) => {
        console.error('Database migration failed:', err.message);
        console.error('  Starting server anyway; routes that touch the database will fail until this is resolved.');
        startListening();
      });
  }
}

module.exports = { createApp };
