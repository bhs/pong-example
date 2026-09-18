'use strict';

/**
 * lib/prisma.js — a single, shared PrismaClient instance.
 *
 * All connection info (host, port, credentials, database name) comes
 * exclusively from the DATABASE_URL environment variable, as declared in
 * prisma/schema.prisma's `datasource db { url = env("DATABASE_URL") }`.
 * Nothing in this app parses or hard-codes MySQL connection details.
 *
 * Prisma's own docs recommend reusing one PrismaClient per process rather
 * than constructing a new one per request (each instance owns its own
 * connection pool) — stashing it on `global` also avoids accumulating extra
 * clients across hot-reloads in long-running dev processes.
 */

const { PrismaClient } = require('@prisma/client');

// Prisma Client resolves its datasource URL (env("DATABASE_URL") in
// schema.prisma) as soon as it's constructed. If DATABASE_URL genuinely
// isn't set yet — e.g. a unit test run, or a container that hasn't
// received its secrets — fall back to a syntactically valid placeholder so
// merely *requiring* this module never crashes the process. Any actual
// query still fails immediately once attempted; this only defers that
// failure from require-time to query-time (mirrors server.js's
// SESSION_SECRET fallback).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'mysql://invalid:invalid@localhost:3306/invalid';
}

if (!global.__pongPrismaClient) {
  global.__pongPrismaClient = new PrismaClient();
}

module.exports = global.__pongPrismaClient;
