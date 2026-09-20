'use strict';

/**
 * __tests__/migrate.test.js
 *
 * Unit tests for scripts/migrate.js's DATABASE_URL derivation, which lets
 * `prisma migrate deploy` share a single source of truth for the
 * preferences database location (SQLITE_PATH) instead of requiring a
 * separately-configured DATABASE_URL everywhere this app is deployed.
 * Does not shell out to the Prisma CLI.
 */

const path = require('path');
const { resolveDatabaseUrl } = require('../scripts/migrate');
const { DEFAULT_DB_PATH }    = require('../db');

describe('scripts/migrate.js resolveDatabaseUrl', () => {
  test('derives a file: DATABASE_URL from SQLITE_PATH when DATABASE_URL is unset', () => {
    const { databaseUrl, absPath } = resolveDatabaseUrl({ SQLITE_PATH: '/tmp/somewhere/prefs.sqlite3' });

    expect(absPath).toBe(path.resolve('/tmp/somewhere/prefs.sqlite3'));
    expect(databaseUrl).toBe(`file:${absPath}`);
  });

  test('falls back to the same default path db.js uses when SQLITE_PATH is unset', () => {
    const { sqlitePath, databaseUrl } = resolveDatabaseUrl({});

    expect(sqlitePath).toBe(DEFAULT_DB_PATH);
    expect(databaseUrl).toBe(`file:${path.resolve(DEFAULT_DB_PATH)}`);
  });

  test('an explicit DATABASE_URL always wins over the derived one', () => {
    const { databaseUrl } = resolveDatabaseUrl({
      SQLITE_PATH: '/tmp/somewhere/prefs.sqlite3',
      DATABASE_URL: 'file:/explicit/path.sqlite3',
    });

    expect(databaseUrl).toBe('file:/explicit/path.sqlite3');
  });
});
