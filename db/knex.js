'use strict';

/**
 * db/knex.js — the single Knex client instance the rest of the app uses.
 *
 * Configuration comes entirely from knexfile.js, which in turn reads the
 * MySQL connection purely from process.env.DATABASE_URL. Creating the
 * client here does not open a connection by itself — mysql2's pool
 * connects lazily on the first query — so simply requiring this module
 * (e.g. from tests that never issue a query) is always safe, even when
 * DATABASE_URL is unset.
 */

const knex       = require('knex');
const knexConfig = require('../knexfile');

module.exports = knex(knexConfig);
