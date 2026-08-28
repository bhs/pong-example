'use strict';

/**
 * server.js — Express API with ephemeral in-process storage and Google OAuth.
 *
 * Storage backend: plain JavaScript Map objects (no external services, no
 * database).  All data is lost when the process exits, which is intentional
 * for the ephemeral-local-storage variation this app builds on.
 *
 * Authentication: Google OAuth 2.0 via passport + passport-google-oauth20.
 * A successful OAuth round-trip upserts a user record (keyed by Google's
 * stable `sub` id) in the ephemeral store and establishes an HttpOnly
 * session cookie (express-session, in-memory store) so the login survives
 * page reloads for the lifetime of the process / cookie.
 *
 * Endpoints
 * ─────────
 *   GET  /auth/google           Redirect to the Google consent screen.
 *   GET  /auth/google/callback  OAuth callback — exchanges code for profile,
 *                                upserts the user, establishes the session.
 *   GET  /auth/logout           Destroy the session (logout).
 *   GET  /me                    Returns the logged-in user (or { user: null }).
 *
 *   POST /api/login              Legacy stub login — accepts any username,
 *                                 returns a session token (kept for backward
 *                                 compatibility with earlier variations).
 *   GET  /api/scores             List all high scores (sorted desc by score).
 *   POST /api/scores             Create or update a high score entry. If the
 *                                 caller has an authenticated Google session
 *                                 and no `player` is supplied, the player is
 *                                 derived from the logged-in user's identity.
 *   GET  /api/scores/:player     Get the high score for a specific player.
 *   DELETE /api/scores/:player   Delete the high score for a specific player.
 *
 *   GET  /health                 Basic health check (200 OK).
 *
 * The module exports { app, store } so unit tests can inject their own store
 * and inspect state without starting a real HTTP server.
 */

const express        = require('express');
const path           = require('path');
const crypto         = require('crypto');
const session        = require('express-session');
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// ── Ephemeral store ────────────────────────────────────────────────────────
//
// Maps kept in memory for the lifetime of the process:
//   sessions  : token → { username, createdAt }             (legacy stub login)
//   scores    : username (lowercase) → { player, score, updatedAt }
//   users     : Google `sub` id → { id, email, name, avatar, createdAt, updatedAt }
//
// Factory function so tests can create isolated instances.

function createStore() {
  return {
    sessions: new Map(),
    scores:   new Map(),
    users:    new Map(),
  };
}

// Module-level default store (used by the real server).
const defaultStore = createStore();

// ── App factory ────────────────────────────────────────────────────────────
//
// Accepting a store parameter makes every endpoint independently testable
// without touching the shared module-level state.

function createApp(store = defaultStore) {
  const app = express();

  app.use(express.json());

  // ── Session middleware (HttpOnly cookie, in-memory store) ────────────────
  //
  // SESSION_SECRET should be set in production. If it isn't, a random secret
  // is generated per-process — sessions simply won't survive a restart,
  // which matches the ephemeral-storage philosophy of the rest of this app.

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

  // ── Google OAuth (passport) ──────────────────────────────────────────────

  /**
   * Upsert a user record keyed by Google's stable `sub` id (mapped to
   * `profile.id` by passport-google-oauth20).
   */
  function upsertGoogleUser(profile) {
    const id     = profile.id;
    const email  = (profile.emails && profile.emails[0] && profile.emails[0].value) || null;
    const name   = profile.displayName || null;
    const avatar = (profile.photos && profile.photos[0] && profile.photos[0].value) || null;

    const existing = store.users.get(id);
    const user = {
      id,
      email:     email  || (existing && existing.email)  || null,
      name:      name   || (existing && existing.name)   || null,
      avatar:    avatar || (existing && existing.avatar) || null,
      createdAt: (existing && existing.createdAt) || Date.now(),
      updatedAt: Date.now(),
    };

    store.users.set(id, user);
    return user;
  }

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser((id, done) => {
    const user = store.users.get(id);
    done(null, user || false);
  });

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
        try {
          const user = upsertGoogleUser(profile);
          done(null, user);
        } catch (err) {
          done(err);
        }
      },
    ));
  }

  // Serve the static Pong game at the root
  app.use(express.static(path.join(__dirname)));

  // ── GET /health ───────────────────────────────────────────────────────────

  app.get('/health', (req, res) => {
    return res.status(200).json({ status: 'ok' });
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
  // Exchanges the authorization code for a profile, upserts the user record,
  // and establishes the session before redirecting back to the app.

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
      const { id, email, name, avatar } = req.user;
      return res.status(200).json({ user: { id, email, name, avatar } });
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
    store.sessions.set(token, { username: player, createdAt: Date.now() });

    return res.status(200).json({ token, username: player });
  });

  // ── GET /api/scores ───────────────────────────────────────────────────────
  //
  // Returns all stored high scores sorted by score descending.
  // Optional query param: ?limit=N  (max 100)

  app.get('/api/scores', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 100);

    const entries = Array.from(store.scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return res.status(200).json({ scores: entries });
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

  app.post('/api/scores', (req, res) => {
    const body  = req.body || {};
    const score = body.score;
    let player  = body.player;

    const hasExplicitPlayer = typeof player === 'string' && player.trim() !== '';

    if (!hasExplicitPlayer && req.isAuthenticated && req.isAuthenticated() && req.user) {
      player = req.user.email || req.user.name || req.user.id;
    }

    if (!player || typeof player !== 'string' || player.trim() === '') {
      return res.status(400).json({ error: 'player is required' });
    }

    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      return res.status(400).json({ error: 'score must be a non-negative finite number' });
    }

    const key      = player.trim().toLowerCase();
    const existing = store.scores.get(key);

    // Only store if it's a new personal best (or first entry)
    if (!existing || score > existing.score) {
      const entry = { player: key, score, updatedAt: Date.now() };
      store.scores.set(key, entry);
      return res.status(200).json({ updated: true, entry });
    }

    return res.status(200).json({ updated: false, entry: existing });
  });

  // ── GET /api/scores/:player ───────────────────────────────────────────────
  //
  // Retrieve the high score for a specific player.

  app.get('/api/scores/:player', (req, res) => {
    const key   = req.params.player.trim().toLowerCase();
    const entry = store.scores.get(key);

    if (!entry) {
      return res.status(404).json({ error: 'player not found' });
    }

    return res.status(200).json({ entry });
  });

  // ── DELETE /api/scores/:player ────────────────────────────────────────────
  //
  // Remove the high score entry for the given player.

  app.delete('/api/scores/:player', (req, res) => {
    const key     = req.params.player.trim().toLowerCase();
    const existed = store.scores.has(key);

    if (!existed) {
      return res.status(404).json({ error: 'player not found' });
    }

    store.scores.delete(key);
    return res.status(200).json({ deleted: true, player: key });
  });

  return app;
}

// ── Start server (when run directly) ──────────────────────────────────────

if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  const HOST = '0.0.0.0';
  const app  = createApp(defaultStore);

  app.listen(PORT, HOST, () => {
    console.log(`Pong server listening on ${HOST}:${PORT}`);
    console.log('Storage: ephemeral in-process Map (data lost on restart)');
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.log('Google OAuth: NOT configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to enable)');
    } else {
      console.log('Google OAuth: configured');
    }
  });
}

module.exports = { createApp, createStore };
