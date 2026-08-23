'use strict';

/**
 * db.js — PostgreSQL connection pool
 *
 * Reads connection details from environment variables with sensible defaults
 * for local development (docker-compose) and production (VPS / any host).
 *
 * Environment variables:
 *   DATABASE_URL  – full connection string (takes priority if set)
 *   PGHOST        – default: "db"       (docker-compose service name)
 *   PGPORT        – default: 5432
 *   PGUSER        – default: "pong"
 *   PGPASSWORD    – default: "pong"
 *   PGDATABASE    – default: "pong"
 */

const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ||
             process.env.DATABASE_URL.includes('127.0.0.1') ||
             process.env.PGSSLMODE === 'disable'
          ? false
          : { rejectUnauthorized: false },
      }
    : {
        host:     process.env.PGHOST     || 'db',
        port:     parseInt(process.env.PGPORT || '5432', 10),
        user:     process.env.PGUSER     || 'pong',
        password: process.env.PGPASSWORD || 'pong',
        database: process.env.PGDATABASE || 'pong',
      }
);

/**
 * Run the SQL migration files in order to bring the schema up to date.
 * Safe to call on every startup (uses IF NOT EXISTS guards).
 */
async function migrate() {
  const fs   = require('fs');
  const path = require('path');

  const migrationsDir = path.join(__dirname, 'db', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
    console.log(`[migrate] Applied: ${file}`);
  }
}

module.exports = { pool, migrate };
