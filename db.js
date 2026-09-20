'use strict';

/**
 * db.js — persistent SQLite connection for the user_preferences table.
 *
 * This is a small, dedicated database file separate from the ephemeral
 * users/scores Maps in server.js (see the 'ephemeral-local-storage' hop this
 * app builds on) — style preferences need to survive process restarts and
 * be visible across devices for the same signed-in user, so they're the
 * first piece of state in this app backed by real on-disk storage.
 *
 * The DB file lives at SQLITE_PATH (default: ./data/preferences.sqlite3,
 * relative to this file) so it can be pointed at a mounted volume in
 * production (see k8s/deployment.yaml). Pass ':memory:' for ephemeral,
 * fully-isolated instances in tests.
 *
 * Schema: the user_preferences table itself is *not* created here anymore.
 * It's defined by a Prisma migration (prisma/migrations/, matching
 * prisma/schema.prisma) and applied with `prisma migrate deploy` before the
 * server starts (see scripts/migrate.js and the Dockerfile) — the same way
 * the rest of this repository's schema changes are made, so the change can
 * be run and withdrawn like any other migration. The one exception is the
 * ':memory:' database used by tests below: it never sees that migration
 * (there's nothing on disk for `prisma migrate deploy` to point at), so its
 * schema is created inline here purely to keep unit tests fast and
 * self-contained.
 */

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, 'data', 'preferences.sqlite3');

/**
 * Opens (creating if necessary) the SQLite database and ensures the
 * user_preferences table exists. Safe to call multiple times.
 *
 * @param {string} [dbPath] - filesystem path, or ':memory:' for an
 *                             in-memory database (used by tests).
 * @returns {import('better-sqlite3').Database}
 */
function createDb(dbPath = process.env.SQLITE_PATH || DEFAULT_DB_PATH) {
  const isMemory = dbPath === ':memory:';

  if (!isMemory) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL mode improves concurrent read/write behaviour; harmless for
  // :memory: databases (better-sqlite3 simply ignores it there).
  db.pragma('journal_mode = WAL');

  if (isMemory) {
    // Test-only convenience: on-disk databases get this schema from the
    // Prisma migration under prisma/migrations/ instead (see the module
    // doc comment above). Kept in sync with
    // prisma/migrations/20240115103000_create_user_preferences/migration.sql.
    //
    // user_id is not declared with a SQL FOREIGN KEY constraint because the
    // users/scores data in this app currently lives in an in-process Map
    // (see server.js's ephemeral store), not in this SQLite database — but
    // it is logically a foreign key onto that user's stable identity (the
    // Google OAuth `sub`, or the legacy login username), and every access
    // in preferencesRepo.js treats it as such.
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id      TEXT PRIMARY KEY,
        paddle_color TEXT NOT NULL,
        ball_color   TEXT NOT NULL,
        bg_color     TEXT NOT NULL,
        preset_name  TEXT,
        updated_at   INTEGER NOT NULL
      );
    `);
  }

  return db;
}

module.exports = { createDb, DEFAULT_DB_PATH };
