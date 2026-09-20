'use strict';

/**
 * scripts/migrate.js — applies pending Prisma migrations to the MySQL
 * database before the server starts.
 *
 * The schema for user_preferences is expressed the way the rest of this
 * repository's schema changes are made: as a versioned Prisma migration
 * under prisma/migrations/ (see prisma/schema.prisma), applied with
 * `prisma migrate deploy` against MySQL 8.4.
 *
 * DATABASE_URL (a mysql:// connection string) is the single source of truth
 * for "where is the preferences database" — the same variable Prisma reads,
 * db.js reads for its own connection pool, and this script passes through
 * unchanged. There is nothing to derive it from (unlike the old SQLite-file
 * setup, where a filesystem path stood in for it): a real database the app
 * cannot run without must fail loudly and immediately if it's missing,
 * rather than the process limping along with no persistence.
 */

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Resolves (and validates) the DATABASE_URL to run migrations against.
 * Exported (pure, no side effects) so it can be unit tested without
 * actually invoking the Prisma CLI.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ databaseUrl: string }}
 * @throws {Error} if DATABASE_URL is not set.
 */
function resolveDatabaseUrl(env = process.env) {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required (e.g. mysql://user:password@host:3306/dbname) — ' +
      'see prisma/schema.prisma.'
    );
  }

  return { databaseUrl };
}

/** Runs `prisma migrate deploy` against the resolved MySQL database. */
function runMigrations(env = process.env) {
  const { databaseUrl } = resolveDatabaseUrl(env);

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    cwd:   path.join(__dirname, '..'),
    env:   { ...env, DATABASE_URL: databaseUrl },
  });
}

if (require.main === module) {
  runMigrations();
}

module.exports = { resolveDatabaseUrl, runMigrations };
