'use strict';

/**
 * knexfile.js — Knex configuration for the MySQL-backed variation of this
 * app.
 *
 * The MySQL connection is read purely from process.env.DATABASE_URL (e.g.
 * "mysql://user:password@host:3306/dbname") — there is no
 * environment-keyed config object here, no hardcoded host/user/password,
 * and nothing else the app needs to select or configure a database. This
 * is intentional: any managed MySQL instance can be plugged in just by
 * setting that one variable, in this file, the `knex` CLI, and
 * db/knex.js (the single Knex client instance the rest of the app uses).
 *
 * Migrations live in ./migrations as plain, auditable SQL wrapped in
 * knex.raw() — see that directory for the users / preferences /
 * high_scores schema. server.js calls knex.migrate.latest() on startup so
 * a fresh managed MySQL instance is always brought up to the current
 * schema before the server starts accepting requests.
 */

module.exports = {
  client: 'mysql2',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
  pool: { min: 0, max: 10 },
};
