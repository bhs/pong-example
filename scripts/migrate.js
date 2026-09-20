'use strict';

/**
 * scripts/migrate.js — applies pending Prisma migrations to the on-disk
 * preferences database before the server starts.
 *
 * The schema for user_preferences is now expressed the way the rest of this
 * repository's schema changes are made: as a versioned Prisma migration
 * under prisma/migrations/ (see prisma/schema.prisma), applied with
 * `prisma migrate deploy`. This replaces the old approach of running an
 * ad-hoc `CREATE TABLE IF NOT EXISTS` from db.js on every boot, so the
 * change can now be run and withdrawn like any other migration in this
 * project.
 *
 * Prisma reads its connection string from DATABASE_URL, but every other
 * piece of this app (db.js, k8s/deployment.yaml, fly.toml) configures the
 * database file location via SQLITE_PATH instead. Rather than requiring
 * every deployment target to keep two env vars in sync, this module derives
 * DATABASE_URL from SQLITE_PATH (falling back to the same default db.js
 * uses) so there's exactly one source of truth for "where is the
 * preferences database file".
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { DEFAULT_DB_PATH } = require('../db');

/**
 * Works out the Prisma DATABASE_URL to use for this run, given the current
 * environment. Exported (pure, no side effects) so it can be unit tested
 * without actually invoking the Prisma CLI.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ sqlitePath: string, absPath: string, databaseUrl: string }}
 */
function resolveDatabaseUrl(env = process.env) {
  const sqlitePath = env.SQLITE_PATH || DEFAULT_DB_PATH;
  const absPath     = path.resolve(sqlitePath);
  const databaseUrl = env.DATABASE_URL || `file:${absPath}`;
  return { sqlitePath, absPath, databaseUrl };
}

/** Runs `prisma migrate deploy` against the resolved database file. */
function runMigrations(env = process.env) {
  const { absPath, databaseUrl } = resolveDatabaseUrl(env);

  // Prisma's sqlite provider will create the database file itself, but not
  // missing parent directories (e.g. a freshly-mounted, empty volume) —
  // make sure it exists first, mirroring what db.js does for direct
  // connections.
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

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
