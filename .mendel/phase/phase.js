#!/usr/bin/env node
'use strict';

/**
 * /mendel/phase — reports which persistent stores this application has, and
 * builds/drops/describes/runs a structural sandbox beside them for
 * rehearsing a migration.
 *
 * It selects its database exactly the way the application does (see
 * lib/prisma.js and prisma/schema.prisma): the single environment variable
 * DATABASE_URL, a MySQL connection string. There is no other config file or
 * variable to read here, and none is invented. Every command below connects
 * with that same credential (sandbox-up and sandbox-down connect it to the
 * sandbox database instead of the application's own, by swapping only the
 * path component of that same URL — see sandboxDatabaseUrl below).
 *
 * Usage:
 *   /mendel/phase probe
 *   /mendel/phase sandbox-build <name>
 *   /mendel/phase sandbox-drop <name>
 *   /mendel/phase sandbox-describe <name>
 *   /mendel/phase sandbox-up <name>     (reads migration_contract's "up" as JSON on stdin)
 *   /mendel/phase sandbox-down <name>   (reads migration_contract's "down" as JSON on stdin)
 */

const { URL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Sandbox names must fall under this prefix, and must be safe to splice
// directly into a backtick-quoted MySQL identifier (hence the restricted
// character class below, rather than relying on backtick-escaping alone).
const SANDBOX_PREFIX = 'mendel_sandbox_';
const SANDBOX_NAME_RE = /^mendel_sandbox_[A-Za-z0-9_]+$/;

// Every right sandbox-build and sandbox-drop need themselves, plus every
// right a migration rehearsed inside the sandbox afterwards will need: this
// repository's migrations create, alter and drop tables, indexes and
// foreign keys (CREATE, ALTER, DROP, INDEX, REFERENCES); MySQL migrations in
// general may also create/alter/drop views and triggers (CREATE VIEW, SHOW
// VIEW, TRIGGER, EVENT); and a migration's up/down SQL may read or write
// rows (INSERT, SELECT, UPDATE, DELETE) — the same rights the application's
// own credential already has on its own database, just not yet on the
// mendel_sandbox_ namespace.
const GRANT_PRIVILEGES = [
  'CREATE',
  'ALTER',
  'DROP',
  'INDEX',
  'REFERENCES',
  'CREATE VIEW',
  'SHOW VIEW',
  'TRIGGER',
  'EVENT',
  'INSERT',
  'SELECT',
  'UPDATE',
  'DELETE'
];

// The name probe reports for this application's one store of record. Reused
// by sandbox-describe below to prefix each collection name with it (per
// migration_contract, collections are named "<store>.<table>" whenever
// there is more than one store of record — this application only ever has
// one, but the prefix is applied unconditionally for that same reason).
const RECORD_STORE_NAME = 'db';

// A constant description of the one migration format the sandbox-up /
// sandbox-down steps below accept (and that a future "apply this for real"
// command, not implemented here, will accept too) for this repository's
// MySQL store of record. It never changes based on what probe finds — it
// describes what this program accepts, not the schema it observed.
//
// `up` names a new Prisma migration the way this repository already writes
// them (see prisma/migrations/20240115000000_init/): a migration directory
// name and the migration.sql it contains, which `prisma migrate deploy`
// (the same command the migrate stage and this application's own
// entrypoint run) applies straight from prisma/migrations/ — sandbox-up
// runs exactly that command against a temporary copy of prisma/migrations/
// with this migration added, pointed at the sandbox database. Prisma
// Migrate has no concept of a down-migration to prefer instead, so `down`
// carries the plain SQL that reverses `up`'s SQL, run directly against the
// MySQL server by sandbox-down (and, later, for real).
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
          'server, never through `prisma migrate deploy`.',
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

// The generated Prisma Client lives in the migrate stage's /app/node_modules
// (see .mendel/Dockerfile). This file is copied to /mendel/phase, outside
// /app, so it is required by its absolute path rather than relying on
// node_modules resolution from its own directory.
//
// With `url` given, connects to that URL instead of DATABASE_URL — used by
// sandbox-down to run against the sandbox database while everything else
// (driver, engine, credential) stays exactly what the application uses.
function loadPrismaClient(url) {
  const { PrismaClient } = require('/app/node_modules/@prisma/client');
  if (url) {
    return new PrismaClient({ datasources: { db: { url } } });
  }
  return new PrismaClient();
}

// The sandbox's own connection string: the application's DATABASE_URL with
// only its path (the database name) replaced — same host, port, credential
// and every other part, since a sandbox lives on the same server as the
// store of record it sits beside.
function sandboxDatabaseUrl(name) {
  const parsed = new URL(process.env.DATABASE_URL);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

// Reads all of stdin and returns it as a string.
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// Splits a semicolon-terminated block of SQL statements (the form
// migration_contract's sqlStatements $def describes) into individual
// statements. Needed because, like CREATE TRIGGER elsewhere in this file,
// this program's only available MySQL client (Prisma Client) sends each
// $executeRawUnsafe call over the server-side prepared-statement protocol,
// which does not accept more than one statement per call.
function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// The database name the application itself reaches, parsed out of
// DATABASE_URL the same way Prisma Client does: the path component of the
// connection string.
function parseAppDatabaseName() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    throw new Error(`DATABASE_URL could not be parsed: ${err.message}`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!name) {
    throw new Error('DATABASE_URL has no database name in its path');
  }
  return name;
}

function isAccessDeniedError(err) {
  const msg = String((err && err.message) || err || '');
  return (
    /access denied/i.test(msg) ||
    /command denied/i.test(msg) ||
    /\b(1044|1142|1143|1227)\b/.test(msg)
  );
}

// Formats the grant this credential needs, addressed to the account it
// actually connects as (read from the server with CURRENT_USER(), which any
// authenticated account may run), and with the mendel_sandbox_ prefix's
// literal underscores escaped — MySQL treats "_" and "%" as wildcards in the
// database part of a GRANT's ON clause, so a literal prefix match requires
// escaping them.
async function describeNeededGrant(conn) {
  let account = 'the account DATABASE_URL connects as';
  try {
    const rows = await conn.$queryRawUnsafe('SELECT CURRENT_USER() AS account');
    const raw = rows && rows[0] && rows[0].account;
    if (raw) {
      const at = raw.lastIndexOf('@');
      const user = raw.slice(0, at).replace(/'/g, "''");
      const host = raw.slice(at + 1).replace(/'/g, "''");
      account = `'${user}'@'${host}'`;
    }
  } catch (_) {
    /* fall back to the generic description above */
  }
  const escapedPrefix = SANDBOX_PREFIX.replace(/_/g, '\\_');
  return (
    `GRANT ${GRANT_PRIVILEGES.join(', ')} ON \`${escapedPrefix}%\`.* TO ${account};`
  );
}

async function reportAccessDenied(conn, command, err) {
  const grant = await describeNeededGrant(conn);
  process.stderr.write(
    `phase ${command}: denied by MySQL (${err.message}).\n` +
    `Ask a database administrator to run:\n  ${grant}\n`
  );
  try {
    await conn.$disconnect();
  } catch (_) {
    /* already broken */
  }
  process.exit(1);
}

function validateSandboxName(command, name, appDb) {
  if (!SANDBOX_NAME_RE.test(name)) {
    process.stderr.write(
      `phase ${command}: "${name}" is not a valid sandbox name; it must match ${SANDBOX_NAME_RE}.\n`
    );
    process.exit(1);
  }
  if (name === appDb) {
    process.stderr.write(
      `phase ${command}: refusing to touch "${name}" — it is a store the application itself uses.\n`
    );
    process.exit(1);
  }
}

async function probe() {
  let prisma;
  try {
    prisma = loadPrismaClient();

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

    const stores = [{ name: RECORD_STORE_NAME, engine, version, role: 'record' }];
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

// Builds `name` as a MySQL database beside the application's own, with the
// same tables (and views/triggers, if any), no rows, other than a whole
// copy of _prisma_migrations — the migration tool's own record of which
// migrations have already been applied, without which `prisma migrate
// deploy` run inside the sandbox would try to reapply every migration from
// scratch against a schema that already has their result.
async function sandboxBuild(name) {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase sandbox-build: ${err.message}\n`);
    process.exit(1);
  }
  validateSandboxName('sandbox-build', name, appDb);

  const conn = loadPrismaClient();
  try {
    // If a previous run died partway through, start clean.
    await conn.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
    await conn.$executeRawUnsafe(`CREATE DATABASE \`${name}\``);

    const objects = await conn.$queryRawUnsafe(
      'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      appDb
    );
    const baseTables = objects
      .filter((o) => o.type === 'BASE TABLE')
      .map((o) => o.name);
    const views = objects.filter((o) => o.type === 'VIEW').map((o) => o.name);

    // Structure only: copy each table's real, current definition (columns,
    // defaults, indexes, primary/unique/foreign keys) from the server
    // itself, not from this repository's schema files or migrations.
    // Foreign keys are disabled while creating so table order doesn't
    // matter — every referenced table is created in this same sandbox.
    await conn.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const table of baseTables) {
        const rows = await conn.$queryRawUnsafe(
          `SHOW CREATE TABLE \`${appDb}\`.\`${table}\``
        );
        // Prisma's MySQL driver doesn't preserve SHOW's own column names
        // (it reports them positionally as f0, f1, ...); SHOW CREATE TABLE
        // always returns exactly (Table, Create Table), in that order.
        const createSql = Object.values(rows[0])[1];
        const sandboxSql = createSql.replace(
          /^CREATE TABLE `([^`]+)`/,
          `CREATE TABLE \`${name}\`.\`$1\``
        );
        await conn.$executeRawUnsafe(sandboxSql);
      }
    } finally {
      await conn.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }

    // Views: information_schema.VIEWS reports the SELECT with its
    // referenced tables already schema-qualified to the production
    // database — repoint that qualifier at the sandbox.
    const appDbQualifier = new RegExp(
      '`' + appDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\.',
      'g'
    );
    for (const view of views) {
      const rows = await conn.$queryRawUnsafe(
        'SELECT VIEW_DEFINITION AS def FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        appDb,
        view
      );
      const definition = rows[0].def.replace(appDbQualifier, `\`${name}\`.`);
      await conn.$executeRawUnsafe(
        `CREATE VIEW \`${name}\`.\`${view}\` AS ${definition}`
      );
    }

    // Triggers: SHOW CREATE TRIGGER returns a statement scoped to the
    // current database with no schema qualifiers — add them, and drop the
    // DEFINER clause since this credential may not hold the privilege to
    // set an arbitrary one.
    const triggers = await conn.$queryRawUnsafe(
      'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
      appDb
    );
    for (const trig of triggers) {
      const rows = await conn.$queryRawUnsafe(
        `SHOW CREATE TRIGGER \`${appDb}\`.\`${trig.name}\``
      );
      // SHOW CREATE TRIGGER always returns (Trigger, sql_mode,
      // SQL Original Statement, character_set_client, collation_connection,
      // Database Collation), in that order — see the SHOW CREATE TABLE
      // comment above for why this is positional rather than by name.
      let createSql = Object.values(rows[0])[2];
      createSql = createSql.replace(/DEFINER=`[^`]*`@`[^`]*`\s*/, '');
      createSql = createSql.replace(/TRIGGER\s+`([^`]+)`/, `TRIGGER \`${name}\`.\`$1\``);
      createSql = createSql.replace(/\bON\s+`([^`]+)`/, `ON \`${name}\`.\`$1\``);
      try {
        await conn.$executeRawUnsafe(createSql);
      } catch (err) {
        if (/1295/.test(String(err && err.message))) {
          throw new Error(
            `production has trigger "${trig.name}", but MySQL refuses CREATE TRIGGER over ` +
            'the server-side prepared-statement protocol that this program\'s only available ' +
            'MySQL client (Prisma Client) always uses, so it cannot be replicated into the sandbox'
          );
        }
        throw err;
      }
    }

    // The one exception: the migration tool's own applied-migrations
    // record, copied whole, and only because it exists.
    const referenceCollections = [];
    if (baseTables.includes('_prisma_migrations')) {
      const inserted = await conn.$executeRawUnsafe(
        `INSERT INTO \`${name}\`.\`_prisma_migrations\` SELECT * FROM \`${appDb}\`.\`_prisma_migrations\``
      );
      referenceCollections.push({ collection: '_prisma_migrations', records: inserted });
    }

    process.stdout.write(JSON.stringify({ reference_collections: referenceCollections }) + '\n');
    await conn.$disconnect();
    process.exit(0);
  } catch (err) {
    if (isAccessDeniedError(err)) {
      await reportAccessDenied(conn, 'sandbox-build', err);
    } else {
      process.stderr.write(`phase sandbox-build: ${err.message || err}\n`);
      try {
        await conn.$disconnect();
      } catch (_) {
        /* already broken */
      }
      process.exit(1);
    }
  }
}

// Drops `name` and everything in it. Safe to call when nothing under that
// name exists — including after a sandbox-build that failed partway.
async function sandboxDrop(name) {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase sandbox-drop: ${err.message}\n`);
    process.exit(1);
  }
  validateSandboxName('sandbox-drop', name, appDb);

  const conn = loadPrismaClient();
  try {
    await conn.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${name}\``);
    await conn.$disconnect();
    process.exit(0);
  } catch (err) {
    if (isAccessDeniedError(err)) {
      await reportAccessDenied(conn, 'sandbox-drop', err);
    } else {
      process.stderr.write(`phase sandbox-drop: ${err.message || err}\n`);
      try {
        await conn.$disconnect();
      } catch (_) {
        /* already broken */
      }
      process.exit(1);
    }
  }
}

// Describes every collection in the sandbox `name` as it is on the server
// right now, changing nothing. See the module docstring for why this reads
// via the same production connection rather than one scoped to the sandbox
// database: information_schema is queried with an explicit schema filter,
// the same way sandbox-build reads production's own structure above.
async function sandboxDescribe(name) {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase sandbox-describe: ${err.message}\n`);
    process.exit(1);
  }
  validateSandboxName('sandbox-describe', name, appDb);

  const conn = loadPrismaClient();
  try {
    const tables = await conn.$queryRawUnsafe(
      'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      name
    );

    const collections = {};
    for (const table of tables) {
      const isBaseTable = table.type === 'BASE TABLE';

      // fields: every column, in the server's own declared order, with its
      // type exactly as the server states it (information_schema.COLUMNS
      // reports COLUMN_TYPE consistently every time, so this text never
      // drifts between two reads of the same structure).
      const fieldRows = await conn.$queryRawUnsafe(
        'SELECT COLUMN_NAME AS col, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        name,
        table.name
      );
      const fields = {};
      for (const row of fieldRows) {
        fields[row.col] = row.type;
      }

      // identity: the primary key, in column order. Views have none.
      let identity = [];
      if (isBaseTable) {
        const pkRows = await conn.$queryRawUnsafe(
          "SELECT COLUMN_NAME AS col FROM information_schema.KEY_COLUMN_USAGE " +
          "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
          name,
          table.name
        );
        identity = pkRows.map((row) => row.col);
      }

      // indexes: every index but the primary key (that's `identity`, not a
      // named index), by name, with its columns and uniqueness — enough
      // that a change to either changes the text.
      const indexes = {};
      if (isBaseTable) {
        const indexRows = await conn.$queryRawUnsafe(
          "SELECT INDEX_NAME AS idx, NON_UNIQUE AS nonUnique, COLUMN_NAME AS col FROM information_schema.STATISTICS " +
          "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME, SEQ_IN_INDEX",
          name,
          table.name
        );
        const grouped = new Map();
        for (const row of indexRows) {
          if (!grouped.has(row.idx)) {
            grouped.set(row.idx, { nonUnique: Number(row.nonUnique), columns: [] });
          }
          grouped.get(row.idx).columns.push(row.col);
        }
        for (const indexName of [...grouped.keys()].sort()) {
          const { nonUnique, columns } = grouped.get(indexName);
          const kind = nonUnique === 0 ? 'UNIQUE' : 'INDEX';
          indexes[indexName] = `${kind} (${columns.map((c) => `\`${c}\``).join(', ')})`;
        }
      }

      // constraints: foreign keys — what they reference and their
      // ON DELETE/ON UPDATE actions, read from the server's own catalogue.
      const constraints = {};
      if (isBaseTable) {
        const fkRows = await conn.$queryRawUnsafe(
          'SELECT kcu.CONSTRAINT_NAME AS name, kcu.COLUMN_NAME AS col, ' +
          'kcu.REFERENCED_TABLE_NAME AS refTable, kcu.REFERENCED_COLUMN_NAME AS refCol, ' +
          'rc.UPDATE_RULE AS updateRule, rc.DELETE_RULE AS deleteRule ' +
          'FROM information_schema.KEY_COLUMN_USAGE kcu ' +
          'JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ' +
          '  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME ' +
          'WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ' +
          'ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION',
          name,
          table.name
        );
        const grouped = new Map();
        for (const row of fkRows) {
          if (!grouped.has(row.name)) {
            grouped.set(row.name, {
              refTable: row.refTable,
              updateRule: row.updateRule,
              deleteRule: row.deleteRule,
              columns: [],
              refColumns: []
            });
          }
          const group = grouped.get(row.name);
          group.columns.push(row.col);
          group.refColumns.push(row.refCol);
        }
        for (const fkName of [...grouped.keys()].sort()) {
          const group = grouped.get(fkName);
          constraints[fkName] =
            `FOREIGN KEY (${group.columns.map((c) => `\`${c}\``).join(', ')}) ` +
            `REFERENCES \`${group.refTable}\` (${group.refColumns.map((c) => `\`${c}\``).join(', ')}) ` +
            `ON DELETE ${group.deleteRule} ON UPDATE ${group.updateRule}`;
        }
      }

      // With more than one store of record, each collection is named with
      // its store's name and a dot in front — this application has only
      // one store of record, but the same naming is applied unconditionally.
      collections[`${RECORD_STORE_NAME}.${table.name}`] = { fields, identity, indexes, constraints };
    }

    // Stable key order, so the same structure always serializes to the
    // same text.
    const ordered = {};
    for (const key of Object.keys(collections).sort()) {
      ordered[key] = collections[key];
    }

    process.stdout.write(JSON.stringify({ collections: ordered }) + '\n');
    await conn.$disconnect();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`phase sandbox-describe: ${err.message || err}\n`);
    try {
      await conn.$disconnect();
    } catch (_) {
      /* already broken */
    }
    process.exit(1);
  }
}

// Runs migration_contract's "up" (a Prisma migration name + its SQL, read
// as JSON from stdin) through this repository's own migration tool, inside
// the sandbox `name` instead of production. It does this the same way the
// migrate stage and this application's own startup apply a migration for
// real — `prisma migrate deploy` — except pointed at the sandbox database,
// and given a temporary copy of prisma/migrations/ with this one migration
// added, so this image's own copy of the repository is never written to
// (the same image rehearses the next migration afterwards).
async function sandboxUp(name) {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase sandbox-up: ${err.message}\n`);
    process.exit(1);
  }
  validateSandboxName('sandbox-up', name, appDb);

  let up;
  try {
    up = JSON.parse(await readStdin());
  } catch (err) {
    process.stderr.write(`phase sandbox-up: stdin was not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
  if (!up || typeof up !== 'object' || typeof up.migration_name !== 'string' || typeof up.sql !== 'string') {
    process.stderr.write(
      'phase sandbox-up: expected {"migration_name": ..., "sql": ...} on stdin, per ' +
      'migration_contract.schema.properties.up.\n'
    );
    process.exit(1);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-sandbox-up-'));
  try {
    const tmpPrisma = path.join(tmpRoot, 'prisma');
    fs.cpSync('/app/prisma', tmpPrisma, { recursive: true });

    const migrationDir = path.join(tmpPrisma, 'migrations', up.migration_name);
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(path.join(migrationDir, 'migration.sql'), up.sql);

    const result = spawnSync(
      'prisma',
      ['migrate', 'deploy', '--schema', path.join(tmpPrisma, 'schema.prisma')],
      { env: { ...process.env, DATABASE_URL: sandboxDatabaseUrl(name) }, encoding: 'utf8' }
    );

    if (result.error) {
      process.stderr.write(`phase sandbox-up: could not run prisma migrate deploy: ${result.error.message}\n`);
      process.exit(1);
    }
    if (result.status !== 0) {
      process.stderr.write(
        `phase sandbox-up: prisma migrate deploy failed:\n${(result.stdout || '') + (result.stderr || '')}`
      );
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(`phase sandbox-up: ${err.message || err}\n`);
    process.exit(1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// Runs migration_contract's "down" (plain SQL, read as JSON from stdin)
// directly against the sandbox `name`'s database — Prisma Migrate has no
// down-migration of its own to run instead, so this runs the SQL the same
// way it will be run for real: statement by statement (see
// splitSqlStatements) against the MySQL server, through the same driver
// and credential the application uses, just pointed at the sandbox.
async function sandboxDown(name) {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase sandbox-down: ${err.message}\n`);
    process.exit(1);
  }
  validateSandboxName('sandbox-down', name, appDb);

  let down;
  try {
    down = JSON.parse(await readStdin());
  } catch (err) {
    process.stderr.write(`phase sandbox-down: stdin was not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
  if (!down || typeof down !== 'object' || typeof down.sql !== 'string') {
    process.stderr.write(
      'phase sandbox-down: expected {"sql": ...} on stdin, per migration_contract.schema.properties.down.\n'
    );
    process.exit(1);
  }

  const conn = loadPrismaClient(sandboxDatabaseUrl(name));
  try {
    for (const statement of splitSqlStatements(down.sql)) {
      await conn.$executeRawUnsafe(statement);
    }
    await conn.$disconnect();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`phase sandbox-down: ${err.message || err}\n`);
    try {
      await conn.$disconnect();
    } catch (_) {
      /* already broken */
    }
    process.exit(1);
  }
}

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === 'probe') {
  probe();
} else if (args.length === 2 && args[0] === 'sandbox-build') {
  sandboxBuild(args[1]);
} else if (args.length === 2 && args[0] === 'sandbox-drop') {
  sandboxDrop(args[1]);
} else if (args.length === 2 && args[0] === 'sandbox-describe') {
  sandboxDescribe(args[1]);
} else if (args.length === 2 && args[0] === 'sandbox-up') {
  sandboxUp(args[1]);
} else if (args.length === 2 && args[0] === 'sandbox-down') {
  sandboxDown(args[1]);
} else {
  process.stderr.write(
    `phase: does not implement ${JSON.stringify(args.join(' '))}; only "probe", ` +
    `"sandbox-build <name>", "sandbox-drop <name>", "sandbox-describe <name>", ` +
    `"sandbox-up <name>" and "sandbox-down <name>" are supported.\n`
  );
  process.exit(1);
}

