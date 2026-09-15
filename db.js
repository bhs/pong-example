'use strict';

/**
 * db.js — Persistent SQLite-backed storage for user style preferences.
 *
 * Unlike the ephemeral in-memory Maps in server.js (scores/sessions/users,
 * which reset on every process restart), style preferences are written to
 * an on-disk SQLite database file so a signed-in player's paddle/ball/
 * background colors follow them across server restarts and across any
 * browser or device they log in from — the server is always the source of
 * truth; the client never caches preferences locally.
 *
 * Uses better-sqlite3 (synchronous API, no callbacks/promises needed for a
 * single small local file). The database holds one table:
 *
 *   preferences : user_id (Google `sub` id, PRIMARY KEY) → paddle_color,
 *                 ball_color, bg_color, updated_at
 *
 * The default location is ./data/pong.db (relative to this file), override-
 * able via the DB_PATH environment variable — in Kubernetes this should
 * point at a path backed by a PersistentVolumeClaim so the file survives
 * pod restarts (see k8s/deployment.yaml).
 */

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, 'data', 'pong.db');

/**
 * Open (creating if necessary) a SQLite database at `dbPath` and ensure the
 * `preferences` table exists. Pass ':memory:' for an isolated, disk-free
 * instance (used by tests).
 */
function openDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL mode is a no-op (and harmless) for ':memory:' databases, and gives
  // better concurrent read/write behaviour for the on-disk case.
  try {
    db.pragma('journal_mode = WAL');
  } catch (_) {
    // Some environments (e.g. certain in-memory configurations) reject WAL;
    // the default rollback journal still works fine for our access pattern.
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      user_id      TEXT PRIMARY KEY,
      paddle_color TEXT NOT NULL,
      ball_color   TEXT NOT NULL,
      bg_color     TEXT NOT NULL,
      updated_at   INTEGER NOT NULL
    );
  `);

  return db;
}

/**
 * Create a small get/set/close wrapper around a SQLite-backed preferences
 * table, keyed by the Google `sub` id already used for sessions elsewhere
 * in this app.
 *
 * @param {string} [dbPath] - defaults to DEFAULT_DB_PATH; pass ':memory:'
 *                            for isolated test instances.
 */
function createPreferencesStore(dbPath = DEFAULT_DB_PATH) {
  const db = openDatabase(dbPath);

  const getStmt = db.prepare(
    'SELECT paddle_color, ball_color, bg_color, updated_at FROM preferences WHERE user_id = ?'
  );

  const setStmt = db.prepare(`
    INSERT INTO preferences (user_id, paddle_color, ball_color, bg_color, updated_at)
    VALUES (@userId, @paddleColor, @ballColor, @bgColor, @updatedAt)
    ON CONFLICT(user_id) DO UPDATE SET
      paddle_color = excluded.paddle_color,
      ball_color   = excluded.ball_color,
      bg_color     = excluded.bg_color,
      updated_at   = excluded.updated_at
  `);

  return {
    /**
     * Returns { paddleColor, ballColor, bgColor, updatedAt } for the given
     * user, or null if no preferences have been saved yet.
     */
    get(userId) {
      const row = getStmt.get(userId);
      if (!row) return null;
      return {
        paddleColor: row.paddle_color,
        ballColor:   row.ball_color,
        bgColor:     row.bg_color,
        updatedAt:   row.updated_at,
      };
    },

    /**
     * Upsert the preferences for a user and return the stored record
     * (including the server-assigned updatedAt timestamp).
     */
    set(userId, { paddleColor, ballColor, bgColor }) {
      const updatedAt = Date.now();
      setStmt.run({ userId, paddleColor, ballColor, bgColor, updatedAt });
      return { paddleColor, ballColor, bgColor, updatedAt };
    },

    /** Close the underlying database connection (used by tests). */
    close() {
      db.close();
    },
  };
}

module.exports = { createPreferencesStore, DEFAULT_DB_PATH };
