'use strict';

/**
 * db.js — persistent MySQL connection pool for the user_preferences table.
 *
 * This is a small, dedicated table in production's MySQL 8.4 database
 * (accessed here directly via mysql2, not through a generated Prisma
 * Client), separate from the ephemeral users/scores Maps in server.js (see
 * the 'ephemeral-local-storage' hop this app builds on) — style preferences
 * need to survive process restarts and be visible across devices for the
 * same signed-in user, so they're the first piece of state in this app
 * backed by a real, durable database.
 *
 * The connection string is read from DATABASE_URL (e.g.
 * "mysql://user:password@host:3306/dbname"), the same environment variable
 * `prisma migrate deploy` uses (see scripts/migrate.js and
 * prisma/schema.prisma) — one source of truth for "where is the preferences
 * database", in dev, in tests, and in production.
 *
 * Schema: the user_preferences table itself is not created here. It's
 * defined by a Prisma migration (prisma/migrations/, matching
 * prisma/schema.prisma) and applied with `prisma migrate deploy` before the
 * server starts (see scripts/migrate.js and the Dockerfile), the same way
 * the rest of this repository's schema changes are made, so the change can
 * be run and withdrawn like any other migration.
 */

const mysql = require('mysql2/promise');

/**
 * Opens a MySQL connection pool. Connections are established lazily on
 * first query, so this is cheap to call even before the database is
 * reachable (callers just need to make sure `prisma migrate deploy` has run
 * — or will have run — before issuing queries).
 *
 * @param {string} [databaseUrl] - a mysql:// connection string. Defaults to
 *                                  process.env.DATABASE_URL. Throws if
 *                                  neither is set — this app cannot run
 *                                  without its database, so it fails loudly
 *                                  and immediately rather than limping along
 *                                  with no persistence.
 * @returns {import('mysql2/promise').Pool}
 */
function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required (e.g. mysql://user:password@host:3306/dbname) — ' +
      'see prisma/schema.prisma / scripts/migrate.js.'
    );
  }

  return mysql.createPool(databaseUrl);
}

/**
 * Deletes every row from user_preferences. Test-only convenience so each
 * test file can start from a clean table without needing a throwaway
 * database per test the way an in-memory SQLite database used to provide —
 * MySQL has no equivalent of ':memory:', so isolation here comes from
 * truncating the (real, migrated) table instead.
 *
 * @param {import('mysql2/promise').Pool} db
 */
async function resetForTests(db) {
  await db.query('DELETE FROM user_preferences');
}

module.exports = { createDb, resetForTests };
