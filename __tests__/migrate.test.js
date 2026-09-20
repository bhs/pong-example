'use strict';

/**
 * __tests__/migrate.test.js
 *
 * Unit tests for scripts/migrate.js's DATABASE_URL resolution. Production is
 * MySQL 8.4 through Prisma, so DATABASE_URL (a mysql:// connection string)
 * is the one required source of truth — there's no filesystem path to
 * derive it from the way the old SQLite-backed setup had. Does not shell out
 * to the Prisma CLI.
 */

const { resolveDatabaseUrl } = require('../scripts/migrate');

describe('scripts/migrate.js resolveDatabaseUrl', () => {
  test('returns the configured DATABASE_URL unchanged', () => {
    const { databaseUrl } = resolveDatabaseUrl({
      DATABASE_URL: 'mysql://user:password@localhost:3306/pong_preferences',
    });

    expect(databaseUrl).toBe('mysql://user:password@localhost:3306/pong_preferences');
  });

  test('throws when DATABASE_URL is unset', () => {
    expect(() => resolveDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });

  test('throws when DATABASE_URL is empty', () => {
    expect(() => resolveDatabaseUrl({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});
