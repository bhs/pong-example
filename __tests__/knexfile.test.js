'use strict';

/**
 * __tests__/knexfile.test.js
 *
 * Confirms Knex is configured to read the MySQL connection purely from
 * process.env.DATABASE_URL, and that migrations point at ./migrations —
 * no real database connection is opened by requiring knexfile.js.
 */

describe('knexfile', () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl) process.env.DATABASE_URL = originalUrl; else delete process.env.DATABASE_URL;
    jest.resetModules();
  });

  test('uses the mysql2 client', () => {
    const knexfile = require('../knexfile');
    expect(knexfile.client).toBe('mysql2');
  });

  test('reads the connection string purely from process.env.DATABASE_URL', () => {
    process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/pongdb';
    jest.resetModules();
    const knexfile = require('../knexfile');
    expect(knexfile.connection).toBe('mysql://user:pass@localhost:3306/pongdb');
  });

  test('picks up a changed DATABASE_URL on re-require', () => {
    process.env.DATABASE_URL = 'mysql://a:b@host1:3306/db1';
    jest.resetModules();
    expect(require('../knexfile').connection).toBe('mysql://a:b@host1:3306/db1');

    process.env.DATABASE_URL = 'mysql://c:d@host2:3306/db2';
    jest.resetModules();
    expect(require('../knexfile').connection).toBe('mysql://c:d@host2:3306/db2');
  });

  test('points migrations at the ./migrations directory', () => {
    const knexfile = require('../knexfile');
    expect(knexfile.migrations.directory).toBe('./migrations');
  });
});
