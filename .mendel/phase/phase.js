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

// A constant description of the one migration format a future "apply" /
// "rehearse" / "reverse" command (not implemented here) will accept for
// this repository's MySQL store of record. It never changes based on what
// probe finds — it describes what this program accepts, not the schema it
// observed.
//
// `up` names a new Prisma migration the way this repository already writes
// them (see prisma/migrations/20240115000000_init/): a migration directory
// name and the migration.sql it contains, which `prisma migrate deploy`
// (the same command the migrate stage and this application's own
// entrypoint run) applies straight from prisma/migrations/. Prisma Migrate
// has no concept of a down-migration to prefer instead, so `down` carries
// the plain SQL that reverses `up`'s SQL against the MySQL server directly
// — the same fallback prisma/migration.json already documents for this
// repository's own init migration.
const MIGRATION_CONTRACT = {
  schema: {
    $defs: {
      migrationName: {
        type: 'string',
        pattern: '^[0-9]{14}_[a-z0-9_]+$',
        description:
          'The directory name to create under prisma/migrations/, following this ' +
          "repository's existing convention (see prisma/migrations/20240115000000_init/): " +
          'a 14-digit UTC timestamp (YYYYMMDDHHMMSS), an underscore, then a short ' +
          'lower_snake_case description of the change.'
      },
      sqlStatements: {
        type: 'string',
        description:
          'One or more MySQL statements, semicolon-terminated, written the same way ' +
          'prisma/migrations/*/migration.sql already is.'
      }
    },
    type: 'object',
    additionalProperties: false,
    required: ['up', 'down'],
    properties: {
      up: {
        type: 'object',
        additionalProperties: false,
        required: ['migration_name', 'sql'],
        description:
          'Applied by writing sql to prisma/migrations/<migration_name>/migration.sql ' +
          'and then running `prisma migrate deploy` against DATABASE_URL — the exact ' +
          'command the migrate stage and this application\'s startup both already run.',
        properties: {
          migration_name: { $ref: '#/$defs/migrationName' },
          sql: { $ref: '#/$defs/sqlStatements' }
        }
      },
      down: {
        type: 'object',
        additionalProperties: false,
        required: ['sql'],
        description:
          'Reverses up.sql completely. Prisma Migrate does not generate or run ' +
          'down-migrations, so this is run as plain SQL directly against the MySQL ' +
          'server (the same fallback prisma/migration.json documents for this ' +
          "repository's existing init migration), never through `prisma migrate deploy`.",
        properties: {
          sql: { $ref: '#/$defs/sqlStatements' }
        }
      }
    }
  },
  description:
    'A migration is an object with exactly two required properties, up and down, and ' +
    'nothing else. up.migration_name and up.sql are written to ' +
    'prisma/migrations/<up.migration_name>/migration.sql and applied by running ' +
    '`prisma migrate deploy` against DATABASE_URL, exactly as this application\'s own ' +
    'startup and the migrate stage do. down.sql is plain SQL that undoes up.sql ' +
    "completely, run directly against the MySQL server, since Prisma Migrate has no " +
    'down-migration of its own to run instead.',
  example: {
    up: {
      migration_name: '20240301000000_add_users_locale',
      sql:
        'ALTER TABLE `users` ADD COLUMN `locale` VARCHAR(191) NULL;'
    },
    down: {
      sql: 'ALTER TABLE `users` DROP COLUMN `locale`;'
    }
  }
};

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

    const stores = [{ name: 'db', engine, version, role: 'record' }];
    const output = { stores };
    // Any reported store of role "record" must come with the migration
    // contract describing the one migration format this program accepts.
    if (stores.some((store) => store.role === 'record')) {
      output.migration_contract = MIGRATION_CONTRACT;
    }

    process.stdout.write(JSON.stringify(output) + '\n');

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
