#!/usr/bin/env node
'use strict';

/**
 * /mendel/phase — reports which persistent stores this application has.
 *
 * It selects its database exactly the way the application does (see
 * lib/prisma.js and prisma/schema.prisma): the single environment variable
 * DATABASE_URL, a MySQL connection string. There is no other config file or
 * variable to read here, and none is invented.
 *
 * Usage: /mendel/phase probe
 */

async function probe() {
  let prisma;
  try {
    // The generated Prisma Client lives in the migrate stage's
    // /app/node_modules (see .mendel/Dockerfile). This file is copied to
    // /mendel/phase, outside /app, so it is required by its absolute path
    // rather than relying on node_modules resolution from its own
    // directory.
    const { PrismaClient } = require('/app/node_modules/@prisma/client');
    prisma = new PrismaClient();

    // Read the engine and version from the server itself — never from
    // configuration — and change nothing else.
    const rows = await prisma.$queryRaw`SELECT VERSION() AS version`;
    const raw = rows && rows[0] && rows[0].version;
    if (!raw) {
      throw new Error('server returned no version string');
    }

    const versionString = String(raw);
    const engine = /mariadb/i.test(versionString) ? 'mariadb' : 'mysql';
    const match = /^(\d+\.\d+\.\d+)/.exec(versionString);
    const version = match ? match[1] : versionString;

    process.stdout.write(
      JSON.stringify({ stores: [{ name: 'db', engine, version, role: 'record' }] }) + '\n'
    );

    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `phase probe: could not reach the database or read its engine/version: ${
        err && err.message ? err.message : err
      }\n`
    );
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch (_) {
        /* already broken; nothing more to do */
      }
    }
    process.exit(1);
  }
}

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === 'probe') {
  probe();
} else {
  process.stderr.write(
    `phase: does not implement ${JSON.stringify(args.join(' '))}; only "probe" is supported.\n`
  );
  process.exit(1);
}
