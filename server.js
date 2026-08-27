'use strict';

/**
 * server.js — Minimal Express API with ephemeral in-process storage.
 *
 * Storage backend: plain JavaScript Map objects (no external services, no
 * configuration, no network calls).  All data is lost when the process exits,
 * which is intentional for the ephemeral-local-storage variation.
 *
 * Endpoints
 * ─────────
 *   POST /api/login           Stub login — accepts any username, returns a session token.
 *   GET  /api/scores          List all high scores (sorted desc by score).
 *   POST /api/scores          Create or update a high score entry.
 *   GET  /api/scores/:player  Get the high score for a specific player.
 *   DELETE /api/scores/:player  Delete the high score for a specific player.
 *
 * The module exports { app, store } so unit tests can inject their own store
 * and inspect state without starting a real HTTP server.
 */

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

// ── Ephemeral store ────────────────────────────────────────────────────────
//
// Two Maps are kept in memory for the lifetime of the process:
//   sessions  : token → { username, createdAt }
//   scores    : username (lowercase) → { player, score, updatedAt }
//
// Factory function so tests can create isolated instances.

function createStore() {
  return {
    sessions: new Map(),
    scores:   new Map(),
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

  // Serve the static Pong game at the root
  app.use(express.static(path.join(__dirname)));

  // ── POST /api/login ──────────────────────────────────────────────────────
  //
  // Stub authentication: any non-empty username is accepted.
  // Returns a random session token (not validated on subsequent requests in
  // this stub implementation — future iterations can add middleware).

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
  // Body: { player: string, score: number }

  app.post('/api/scores', (req, res) => {
    const { player, score } = req.body || {};

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
    const key   = req.params.player.trim().toLowerCase();
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
  });
}

module.exports = { createApp, createStore };
