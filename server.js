'use strict';

/**
 * server.js — Express API with ephemeral in-process storage and server-session-cookie auth.
 *
 * Storage backend: plain JavaScript Map objects (no external services, no
 * configuration, no network calls).  All data is lost when the process exits,
 * which is intentional for the ephemeral-local-storage variation.
 *
 * Auth approach: server-session-cookie
 *   - Passwords are hashed with bcryptjs before storage.
 *   - On successful register/login a UUID session ID is created, stored in a
 *     server-side Map (sessionId → userId), and sent to the browser as an
 *     HttpOnly Set-Cookie header via cookie-parser.
 *   - GET /me reads the cookie, looks up the session, and returns the user.
 *   - DELETE /session invalidates the server-side record and clears the cookie.
 *
 * Endpoints
 * ─────────
 *   POST   /api/register         Register a new user (email + password).
 *   POST   /api/login            Login with email + password; sets session cookie.
 *   GET    /api/me               Return the currently logged-in user (from cookie).
 *   DELETE /api/session          Logout: invalidate session + clear cookie.
 *
 *   GET    /api/scores           List all high scores (sorted desc by score).
 *   POST   /api/scores           Create or update a high score entry (auth required).
 *   GET    /api/scores/:player   Get the high score for a specific player.
 *   DELETE /api/scores/:player   Delete the high score for a specific player.
 *
 * The module exports { app, store } so unit tests can inject their own store
 * and inspect state without starting a real HTTP server.
 */

const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
const bcrypt       = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// ── Constants ──────────────────────────────────────────────────────────────

const COOKIE_NAME   = 'pong_sid';
const BCRYPT_ROUNDS = 10;

// ── Ephemeral store ────────────────────────────────────────────────────────
//
// Four Maps are kept in memory for the lifetime of the process:
//   users     : email (lowercase) → { id, email, passwordHash, createdAt }
//   sessions  : sessionId (uuid) → { userId, email, createdAt }
//   scores    : username (lowercase) → { player, score, updatedAt }
//   (legacy)
//   legacySessions : token → { username, createdAt }
//
// Factory function so tests can create isolated instances.

function createStore() {
  return {
    users:          new Map(),   // email → { id, email, passwordHash, createdAt }
    sessions:       new Map(),   // sessionId → { userId, email, createdAt }
    scores:         new Map(),   // player → { player, score, updatedAt }
    legacySessions: new Map(),   // token → { username, createdAt }  (kept for compat)
  };
}

// Module-level default store (used by the real server).
const defaultStore = createStore();

// ── App factory ────────────────────────────────────────────────────────────

function createApp(store = defaultStore) {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Serve the static Pong game at the root
  app.use(express.static(path.join(__dirname)));

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Look up the session from the request cookie.
   * Returns the session object { userId, email, createdAt } or null.
   */
  function getSession(req) {
    const sid = req.cookies && req.cookies[COOKIE_NAME];
    if (!sid) return null;
    return store.sessions.get(sid) || null;
  }

  /**
   * Create a new server-side session and set the HttpOnly cookie on the response.
   * Returns the new session ID.
   */
  function createSession(res, userId, email) {
    const sid = uuidv4();
    store.sessions.set(sid, { userId, email, createdAt: Date.now() });
    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: 'lax',
      path:     '/',
      // No 'secure' flag so it works over plain HTTP in dev/Docker
    });
    return sid;
  }

  /**
   * Destroy a session by ID and clear the cookie.
   */
  function destroySession(res, sid) {
    store.sessions.delete(sid);
    res.clearCookie(COOKIE_NAME, { path: '/' });
  }

  // ── POST /api/register ─────────────────────────────────────────────────────
  //
  // Register a new user with email + password.
  // Passwords are hashed with bcrypt before storing.
  // On success, a server-side session is created and the ID is sent as an
  // HttpOnly cookie.

  app.post('/api/register', async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || email.trim() === '') {
      return res.status(400).json({ error: 'email is required' });
    }

    if (!password || typeof password !== 'string' || password.length < 1) {
      return res.status(400).json({ error: 'password is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (store.users.has(normalizedEmail)) {
      return res.status(409).json({ error: 'email already registered' });
    }

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const userId = uuidv4();
      const user = { id: userId, email: normalizedEmail, passwordHash, createdAt: Date.now() };
      store.users.set(normalizedEmail, user);

      createSession(res, userId, normalizedEmail);

      return res.status(201).json({ user: { id: userId, email: normalizedEmail } });
    } catch (err) {
      return res.status(500).json({ error: 'internal server error' });
    }
  });

  // ── POST /api/login ────────────────────────────────────────────────────────
  //
  // Authenticate with email + password.
  // On success, creates a server-side session and sets the HttpOnly cookie.

  app.post('/api/login', async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || email.trim() === '') {
      return res.status(400).json({ error: 'email is required' });
    }

    if (!password || typeof password !== 'string' || password.length < 1) {
      return res.status(400).json({ error: 'password is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = store.users.get(normalizedEmail);

    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    try {
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return res.status(401).json({ error: 'invalid credentials' });
      }

      createSession(res, user.id, normalizedEmail);

      return res.status(200).json({ user: { id: user.id, email: normalizedEmail } });
    } catch (err) {
      return res.status(500).json({ error: 'internal server error' });
    }
  });

  // ── GET /api/me ────────────────────────────────────────────────────────────
  //
  // Check whether the current request is authenticated.
  // Returns the logged-in user object or 401 if not authenticated.

  app.get('/api/me', (req, res) => {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'not authenticated' });
    }
    return res.status(200).json({ user: { id: session.userId, email: session.email } });
  });

  // ── DELETE /api/session ────────────────────────────────────────────────────
  //
  // Logout: destroy the server-side session record and clear the cookie.

  app.delete('/api/session', (req, res) => {
    const sid = req.cookies && req.cookies[COOKIE_NAME];
    if (sid) {
      destroySession(res, sid);
    }
    return res.status(200).json({ loggedOut: true });
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
  // Create or update (upsert) a high score for the authenticated user.
  // Requires a valid session cookie — returns 401 if not authenticated.
  // Only updates if the new score is strictly higher than the stored one.
  // Body: { score: number }  (player name derived from the session email)

  app.post('/api/scores', (req, res) => {
    const session = getSession(req);
    if (!session) {
      return res.status(401).json({ error: 'authentication required to save scores' });
    }

    const { score } = req.body || {};

    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      return res.status(400).json({ error: 'score must be a non-negative finite number' });
    }

    const key      = session.email;
    const existing = store.scores.get(key);

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
  const app  = createApp(defaultStore);

  app.listen(PORT, () => {
    console.log(`Pong server listening on :${PORT}`);
    console.log('Storage: ephemeral in-process Map (data lost on restart)');
    console.log('Auth: server-session-cookie (bcryptjs + HttpOnly cookie)');
  });
}

module.exports = { createApp, createStore };
