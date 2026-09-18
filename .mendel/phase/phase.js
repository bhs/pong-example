#!/usr/bin/env node
'use strict';

/**
 * /mendel/phase — reports which persistent stores this application has.
 *
 * This mirrors server.js's own module header: the application's "sessions",
 * "scores" and "users" data all live in plain in-process JavaScript Map
 * objects, and are intentionally lost whenever the process restarts. There
 * is no database, no persistent volume, and no external store of record —
 * the same conclusion the migrate stage in .mendel/Dockerfile draws, by
 * inspecting the same source. So there is nothing here to connect to or
 * report a version for.
 *
 * Usage: /mendel/phase probe
 */

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === 'probe') {
  process.stderr.write(
    'This application keeps no durable state (see server.js): no database, ' +
    'no persistent volume, no external store of record. Reporting no stores.\n'
  );
  process.stdout.write(JSON.stringify({ stores: [] }) + '\n');
  process.exit(0);
}

process.stderr.write(
  `phase: does not implement ${JSON.stringify(args.join(' '))}; only "probe" is supported.\n`
);
process.exit(1);
