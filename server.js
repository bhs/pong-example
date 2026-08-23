'use strict';

/**
 * server.js — Express API server for the Pong high-score backend
 *
 * Routes
 * ──────
 *   POST   /api/auth/register   Register a new user
 *   POST   /api/auth/login      Authenticate and receive a JWT
 *   POST   /api/scores          Submit a score (JWT required)
 *   GET    /api/scores          Get the global leaderboard (top 10)
 *   GET    /api/scores/me       Get the authenticated user's scores (JWT required)
 *   GET    /                    Serve the Pong front-end (index.html)
 *   GET    /health              Health-check endpoint
 */

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { pool, migrate } = require('./db');
const { hashPassword, verifyPassword, signToken, requireAuth } = require('./auth');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Validation helpers ────────────────────────────────────────────────────────

/** Validate username: 3–64 alphanumeric / underscore characters. */
function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{3,64}$/.test(u);
}

/** Validate password: 6–128 characters. */
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 128;
}

/** Validate score: non-negative integer. */
function isValidScore(s) {
  return Number.isInteger(s) && s >= 0;
}

// ── App factory ───────────────────────────────────────────────────────────────

/**
 * Build and return the Express application.
 * Separating the factory from listen() makes the app testable.
 *
 * @param {import('pg').Pool} db - pg Pool instance (defaults to the real pool)
 */
function createApp(db = pool) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ── Auth routes ─────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/register
   * Body: { username, password }
   * Creates a new user account and returns a JWT.
   */
  app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body || {};

    if (!isValidUsername(username)) {
      return res.status(400).json({
        error: 'username must be 3–64 alphanumeric/underscore characters',
      });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({
        error: 'password must be 6–128 characters',
      });
    }

    try {
      const hash = await hashPassword(password);
      const result = await db.query(
        'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
        [username, hash]
      );
      const user  = result.rows[0];
      const token = signToken({ id: user.id, username: user.username });
      return res.status(201).json({ token, username: user.username });
    } catch (err) {
      if (err.code === '23505') {
        // Unique-constraint violation — username already taken
        return res.status(409).json({ error: 'Username already taken' });
      }
      console.error('[register]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/auth/login
   * Body: { username, password }
   * Returns a JWT on success.
   */
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    try {
      const result = await db.query(
        'SELECT id, username, password FROM users WHERE username = $1',
        [username]
      );

      const user = result.rows[0];
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const match = await verifyPassword(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = signToken({ id: user.id, username: user.username });
      return res.json({ token, username: user.username });
    } catch (err) {
      console.error('[login]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Score routes ─────────────────────────────────────────────────────────────

  /**
   * POST /api/scores
   * Header: Authorization: Bearer <token>
   * Body: { score }
   * Submits a new score for the authenticated user.
   */
  app.post('/api/scores', requireAuth, async (req, res) => {
    const { score } = req.body || {};

    if (!isValidScore(score)) {
      return res.status(400).json({ error: 'score must be a non-negative integer' });
    }

    try {
      const result = await db.query(
        `INSERT INTO high_scores (user_id, score)
         VALUES ($1, $2)
         RETURNING id, user_id, score, submitted_at`,
        [req.user.id, score]
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[submit score]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/scores
   * Returns the global top-10 leaderboard (best score per user).
   */
  app.get('/api/scores', async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT u.username,
                MAX(hs.score)    AS best_score,
                COUNT(hs.id)     AS total_games,
                MAX(hs.submitted_at) AS last_played
         FROM   high_scores hs
         JOIN   users u ON u.id = hs.user_id
         GROUP  BY u.username
         ORDER  BY best_score DESC, last_played ASC
         LIMIT  10`
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[leaderboard]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/scores/me
   * Header: Authorization: Bearer <token>
   * Returns the authenticated user's score history (most recent first).
   */
  app.get('/api/scores/me', requireAuth, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, score, submitted_at
         FROM   high_scores
         WHERE  user_id = $1
         ORDER  BY submitted_at DESC
         LIMIT  50`,
        [req.user.id]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error('[my scores]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Static front-end ─────────────────────────────────────────────────────────
  // Serve the Pong index.html for any non-API route.
  app.use(express.static(path.join(__dirname)));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  return app;
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  // Run SQL migrations before accepting traffic
  await migrate();

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[server] Pong API listening on http://0.0.0.0:${PORT}`);
  });
}

// Only start the server when this file is the entry point,
// not when it is required by tests.
if (require.main === module) {
  start().catch((err) => {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { createApp, isValidUsername, isValidPassword, isValidScore };
