'use strict';

/**
 * __tests__/migrations.test.js
 *
 * Migrations are plain SQL wrapped in knex.raw() (see ../migrations), so
 * they can be checked by capturing the SQL text passed to `raw()` — no
 * real database connection is needed. This asserts the schema documented
 * in the task: no password/bcrypt columns on users, the FKs on
 * preferences and high_scores, and the descending index high_scores is
 * always read through.
 */

const usersMigration       = require('../migrations/20240601000001_create_users');
const preferencesMigration = require('../migrations/20240601000002_create_preferences');
const highScoresMigration  = require('../migrations/20240601000003_create_high_scores');

// A fake "knex" whose only job is to capture the SQL text handed to raw().
const fakeKnex = { raw: (sql) => sql };

describe('users migration', () => {
  const sql = usersMigration.up(fakeKnex);

  test('creates the users table keyed by google_id', () => {
    expect(sql).toMatch(/CREATE TABLE users/i);
    expect(sql).toMatch(/google_id\s+VARCHAR/i);
    expect(sql).toMatch(/UNIQUE KEY users_google_id_unique \(google_id\)/i);
  });

  test('has no password or bcrypt column — auth is delegated to Google', () => {
    expect(sql).not.toMatch(/password/i);
    expect(sql).not.toMatch(/bcrypt/i);
  });

  test('down drops the table', () => {
    expect(usersMigration.down(fakeKnex)).toMatch(/DROP TABLE IF EXISTS users/i);
  });
});

describe('preferences migration', () => {
  const sql = preferencesMigration.up(fakeKnex);

  test('creates the preferences table with a user_id foreign key', () => {
    expect(sql).toMatch(/CREATE TABLE preferences/i);
    expect(sql).toMatch(/FOREIGN KEY \(user_id\) REFERENCES users \(id\)/i);
  });

  test('down drops the table', () => {
    expect(preferencesMigration.down(fakeKnex)).toMatch(/DROP TABLE IF EXISTS preferences/i);
  });
});

describe('high_scores migration', () => {
  const sql = highScoresMigration.up(fakeKnex);

  test('creates the high_scores table with a descending score index', () => {
    expect(sql).toMatch(/CREATE TABLE high_scores/i);
    expect(sql).toMatch(/KEY high_scores_score_index \(score DESC\)/i);
  });

  test('links to users via an optional foreign key', () => {
    expect(sql).toMatch(/FOREIGN KEY \(user_id\) REFERENCES users \(id\)/i);
  });

  test('down drops the table', () => {
    expect(highScoresMigration.down(fakeKnex)).toMatch(/DROP TABLE IF EXISTS high_scores/i);
  });
});
