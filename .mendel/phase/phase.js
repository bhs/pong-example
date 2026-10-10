#!/usr/bin/env node
'use strict';

/**
 * /mendel/phase — reports which persistent stores this application has,
 * builds/drops/describes/runs a structural sandbox beside them for
 * rehearsing a migration, and applies/withdraws a migration against
 * production itself.
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
 *   /mendel/phase production-describe
 *   /mendel/phase production-up         (reads migration_contract's "up" as JSON on stdin)
 *   /mendel/phase production-down       (reads migration_contract's "down" as JSON on stdin)
 *
 * The production-* commands take no <name>: they act on the application's
 * own database, found exactly the way the application finds it (DATABASE_URL
 * — see above). They are the only commands here that change production;
 * production-describe only reads. production-up and production-down share
 * their implementation with sandbox-up/sandbox-down (see applyMigrationUp
 * and applyMigrationDown below) — the only difference is which database URL
 * they run against.
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
// VIEW, TRIGGER); and a migration's up/down SQL may read or write
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
// entrypoint run) applies straight from prisma/migrations/ — sandbox-up and
// production-up both run exactly that command against a temporary copy of
// prisma/migrations/ with this migration added, pointed at the sandbox
// database or at DATABASE_URL respectively, so the tool records the
// migration as applied exactly as it would if it had been committed and
// deployed normally. Prisma Migrate has no concept of a down-migration to
// prefer instead, so `down` carries the plain SQL that reverses `up`'s SQL
// — run with `prisma db execute` by sandbox-down and
// production-down — plus the same migration_name, so those two commands can
// delete the row `up` left in Prisma's own `_prisma_migrations` bookkeeping
// table, leaving the tool as if the migration had never been applied.
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
        required: ['migration_name', 'sql'],
        description:
          'Reverses up.sql completely, then deletes the row up left in Prisma\'s own ' +
          '_prisma_migrations bookkeeping table (matched by migration_name), so a later ' +
          'apply of the same migration runs it again instead of finding it already done. ' +
          'Prisma Migrate does not generate or run down-migrations, so the SQL is run as one ' +
          'script with `prisma db execute` and the bookkeeping row is then deleted, never ' +
          'through `prisma migrate deploy`.',
        properties: {
          migration_name: { $ref: '#/$defs/migrationName' },
          sql: { $ref: '#/$defs/sqlStatements' }
        }
      }
    }
  },
  description:
    'A migration is an object with exactly two required properties, up and down, and ' +
    'nothing else. up.migration_name and up.sql are written to ' +
    'prisma/migrations/<up.migration_name>/migration.sql and applied by running ' +
    '`prisma migrate deploy` against the target database, exactly as this application\'s ' +
    'own startup and the migrate stage do. down.sql is plain SQL that undoes up.sql ' +
    'completely, run as one script with `prisma db execute` (Prisma Migrate has no ' +
    'down-migration of its own to run instead), after which the row up.migration_name left ' +
    'in _prisma_migrations is deleted, so the tool\'s bookkeeping ends up exactly as if the ' +
    'migration had never been applied.',
  example: {
    up: {
      migration_name: '20240601000000_add_users_locale',
      sql:
        '-- AlterTable\nALTER TABLE `users` ADD COLUMN `locale` VARCHAR(191) NULL;'
    },
    down: {
      migration_name: '20240601000000_add_users_locale',
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

// Runs a SQL script against `databaseUrl` with `prisma db execute`, the
// migration tool's own way of applying raw SQL. Unlike Prisma Client's raw
// queries (one statement per call, over the server-side prepared-statement
// protocol, which MySQL refuses for CREATE TRIGGER), it accepts a whole
// script. The schema file is only read, for its `url = env("DATABASE_URL")`
// datasource, so nothing is written to this image's copy of the repository.
function runSqlScript(databaseUrl, sql) {
  return spawnSync(
    'prisma',
    ['db', 'execute', '--stdin', '--schema', '/app/prisma/schema.prisma'],
    { input: sql, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' }
  );
}

function scriptFailure(result) {
  if (result.error) return result.error.message;
  return ((result.stdout || '') + (result.stderr || '')).trim() || `exit status ${result.status}`;
}

// Quotes a name as a MySQL identifier.
function quoteIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
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

    // MariaDB prefixes its version with "5.5.5-" for replication
    // compatibility; the real version follows it.
    const versionString = String(raw).replace(/^5\.5\.5-(?=\d+\.\d+\.\d+-MariaDB)/i, '');
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

// Exercises, inside the freshly created (still empty) sandbox, every right a
// rehearsal will need: creating, altering and dropping tables, indexes,
// foreign keys, views and triggers, and reading and writing rows. Run
// before anything is copied, so that a credential missing any one of them is
// told about all of them at once rather than one refusal at a time. Only
// scratch objects inside the sandbox are touched, and all are removed again.
async function verifyRights(conn, name, url) {
  const q = (t) => `${quoteIdent(name)}.${quoteIdent(t)}`;
  const a = q('_phase_probe_a');
  const b = q('_phase_probe_b');
  const v = q('_phase_probe_v');
  await conn.$executeRawUnsafe(`CREATE TABLE ${a} (id INT NOT NULL, PRIMARY KEY (id))`);
  await conn.$executeRawUnsafe(`CREATE TABLE ${b} (id INT NOT NULL, a_id INT NOT NULL, PRIMARY KEY (id))`);
  await conn.$executeRawUnsafe(`ALTER TABLE ${b} ADD COLUMN c INT NULL`);
  await conn.$executeRawUnsafe(`CREATE INDEX _phase_probe_i ON ${b} (c)`);
  await conn.$executeRawUnsafe(
    `ALTER TABLE ${b} ADD CONSTRAINT _phase_probe_fk FOREIGN KEY (a_id) REFERENCES ${a} (id)`
  );
  await conn.$executeRawUnsafe(`INSERT INTO ${a} (id) VALUES (1)`);
  await conn.$queryRawUnsafe(`SELECT id FROM ${a}`);
  await conn.$executeRawUnsafe(`UPDATE ${a} SET id = 2`);
  await conn.$executeRawUnsafe(`DELETE FROM ${a}`);
  await conn.$executeRawUnsafe(`CREATE VIEW ${v} AS SELECT id FROM ${a}`);
  await conn.$queryRawUnsafe(`SHOW CREATE VIEW ${v}`);
  await conn.$executeRawUnsafe(`DROP VIEW ${v}`);

  // Triggers can only be created through the tool's script executor. Only a
  // refusal of the right itself counts here: a server that refuses triggers
  // for some other reason (e.g. binary logging settings) is not something a
  // grant can fix.
  const t = q('_phase_probe_t');
  const made = runSqlScript(
    url,
    `CREATE TRIGGER ${t} BEFORE INSERT ON ${a} FOR EACH ROW SET @phase_probe = 1;\n`
  );
  if (made.status === 0) {
    const dropped = runSqlScript(url, `DROP TRIGGER ${t};\n`);
    if (dropped.status !== 0) throw new Error(scriptFailure(dropped));
  } else if (isAccessDeniedError(new Error(scriptFailure(made)))) {
    throw new Error(scriptFailure(made));
  } else {
    process.stderr.write(`phase: note: could not check the TRIGGER right: ${scriptFailure(made)}\n`);
  }

  await conn.$executeRawUnsafe(`DROP TABLE ${b}`);
  await conn.$executeRawUnsafe(`DROP TABLE ${a}`);
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
    await conn.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
    await conn.$executeRawUnsafe(`CREATE DATABASE ${quoteIdent(name)}`);
    await verifyRights(conn, name, sandboxDatabaseUrl(name));

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
    // matter — every referenced table is created in this same sandbox. The
    // setting is per connection, so it all runs in one transaction, which
    // pins the work to a single connection of Prisma's pool.
    await conn.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
      try {
        for (const table of baseTables) {
          const rows = await tx.$queryRawUnsafe(
            `SHOW CREATE TABLE ${quoteIdent(appDb)}.${quoteIdent(table)}`
          );
          // SHOW CREATE TABLE always returns exactly (Table, Create Table),
          // in that order; read it positionally rather than by name.
          const createSql = Object.values(rows[0])[1];
          const sandboxSql = createSql.replace(
            /^CREATE TABLE `((?:[^`]|``)+)`/,
            (_, tableName) => `CREATE TABLE ${quoteIdent(name)}.\`${tableName}\``
          );
          await tx.$executeRawUnsafe(sandboxSql);
        }
      } finally {
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
      }
    }, { timeout: 600000, maxWait: 60000 });

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
      const definition = rows[0].def.replace(appDbQualifier, () => `${quoteIdent(name)}.`);
      await conn.$executeRawUnsafe(
        `CREATE VIEW ${quoteIdent(name)}.${quoteIdent(view)} AS ${definition}`
      );
    }

    // Triggers: rebuilt from information_schema.TRIGGERS (timing, event,
    // table and body), created inside the sandbox through the tool's script
    // executor, since MySQL refuses CREATE TRIGGER over the prepared-statement
    // protocol that Prisma Client's raw queries use. No DEFINER is given, so
    // they are created as this credential.
    const triggers = await conn.$queryRawUnsafe(
      'SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, ' +
      'EVENT_OBJECT_TABLE AS tbl, ACTION_STATEMENT AS body ' +
      'FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME',
      appDb
    );
    for (const trig of triggers) {
      const created = runSqlScript(
        sandboxDatabaseUrl(name),
        `CREATE TRIGGER ${quoteIdent(name)}.${quoteIdent(trig.name)} ${trig.timing} ${trig.event} ` +
        `ON ${quoteIdent(name)}.${quoteIdent(trig.tbl)} FOR EACH ROW ${trig.body};\n`
      );
      if (created.status !== 0) throw new Error(scriptFailure(created));
    }

    // The one exception: the migration tool's own applied-migrations
    // record, copied whole, and only because it exists.
    const referenceCollections = [];
    if (baseTables.includes('_prisma_migrations')) {
      const inserted = await conn.$executeRawUnsafe(
        `INSERT INTO ${quoteIdent(name)}.\`_prisma_migrations\` SELECT * FROM ${quoteIdent(appDb)}.\`_prisma_migrations\``
      );
      referenceCollections.push({ collection: '_prisma_migrations', records: inserted });
    }

    process.stdout.write(JSON.stringify({ reference_collections: referenceCollections }) + '\n');
    await conn.$disconnect();
    process.exit(0);
  } catch (err) {
    try {
      await conn.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
    } catch (_) {
      /* best effort: sandbox-drop is run after a failed build too */
    }
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
    await conn.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
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

// Describes every collection in the MySQL database `schemaName` as it is on
// the server right now, changing nothing — shared by sandbox-describe
// (schemaName is a sandbox) and production-describe (schemaName is the
// application's own database), so the two describe the same structure
// identically. information_schema is queried with an explicit schema
// filter, the same way sandbox-build reads production's own structure
// above, rather than by connecting with that database selected as default.
async function describeSchema(conn, schemaName) {
  // A schema that is not there is an error, not an empty structure.
  const present = await conn.$queryRawUnsafe(
    'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    schemaName
  );
  if (present.length === 0) {
    throw new Error(`there is no database named "${schemaName}" on the server`);
  }

  const tables = await conn.$queryRawUnsafe(
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    schemaName
  );

  const checkTable = await conn.$queryRawUnsafe(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'CHECK_CONSTRAINTS'"
  );
  const hasCheckConstraints = checkTable.length > 0;

  const collections = {};
    for (const table of tables) {
      const isBaseTable = table.type === 'BASE TABLE';

      // fields: every column, in the server's own declared order, with its
      // type exactly as the server states it (information_schema.COLUMNS
      // reports COLUMN_TYPE consistently every time, so this text never
      // drifts between two reads of the same structure).
      const fieldRows = await conn.$queryRawUnsafe(
        'SELECT COLUMN_NAME AS col, COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        schemaName,
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
          schemaName,
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
          "SELECT INDEX_NAME AS idx, NON_UNIQUE AS nonUnique, COLUMN_NAME AS col, SUB_PART AS subPart, " +
          "INDEX_TYPE AS indexType, COLLATION AS direction FROM information_schema.STATISTICS " +
          "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME, SEQ_IN_INDEX",
          schemaName,
          table.name
        );
        const grouped = new Map();
        for (const row of indexRows) {
          if (!grouped.has(row.idx)) {
            grouped.set(row.idx, {
              nonUnique: Number(row.nonUnique),
              indexType: String(row.indexType).toUpperCase(),
              columns: []
            });
          }
          // A column's text carries its prefix length and descending order,
          // so a change to either changes the index's text.
          grouped.get(row.idx).columns.push(
            `\`${row.col}\`` +
            (row.subPart === null || row.subPart === undefined ? '' : `(${Number(row.subPart)})`) +
            (row.direction === 'D' ? ' DESC' : '')
          );
        }
        for (const indexName of [...grouped.keys()].sort()) {
          const { nonUnique, indexType, columns } = grouped.get(indexName);
          const kind =
            indexType === 'FULLTEXT' || indexType === 'SPATIAL'
              ? indexType
              : nonUnique === 0 ? 'UNIQUE' : 'INDEX';
          const using = indexType === 'BTREE' || kind === indexType ? '' : ` USING ${indexType}`;
          indexes[indexName] = `${kind} (${columns.join(', ')})${using}`;
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
          schemaName,
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

      // CHECK constraints, where this server has them (MySQL 8.0.16 and
      // later, MariaDB 10.2 and later).
      if (isBaseTable && hasCheckConstraints) {
        const checkRows = await conn.$queryRawUnsafe(
          'SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause ' +
          'FROM information_schema.TABLE_CONSTRAINTS tc ' +
          'JOIN information_schema.CHECK_CONSTRAINTS cc ' +
          '  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME ' +
          "WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK' " +
          'ORDER BY tc.CONSTRAINT_NAME',
          schemaName,
          table.name
        );
        for (const row of checkRows) {
          constraints[row.name] = `CHECK (${row.clause})`;
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

  return ordered;
}

// Describes the sandbox `name` by running describeSchema against it,
// printing the result exactly as production-describe does. Changes
// nothing.
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
    const collections = await describeSchema(conn, name);
    process.stdout.write(JSON.stringify({ collections }) + '\n');
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

// Describes the application's own database — exactly the same code as
// sandbox-describe (describeSchema above), pointed at appDb instead of a
// sandbox. Changes nothing.
async function productionDescribe() {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase production-describe: ${err.message}\n`);
    process.exit(1);
  }

  const conn = loadPrismaClient();
  try {
    const collections = await describeSchema(conn, appDb);
    process.stdout.write(JSON.stringify({ collections }) + '\n');
    await conn.$disconnect();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`phase production-describe: ${err.message || err}\n`);
    try {
      await conn.$disconnect();
    } catch (_) {
      /* already broken */
    }
    process.exit(1);
  }
}

// Reads migration_contract's "up" off stdin and validates its shape —
// shared by sandbox-up and production-up.
async function readUpPayload(command) {
  let up;
  try {
    up = JSON.parse(await readStdin());
  } catch (err) {
    process.stderr.write(`phase ${command}: stdin was not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
  if (!up || typeof up !== 'object' || typeof up.migration_name !== 'string' || typeof up.sql !== 'string') {
    process.stderr.write(
      `phase ${command}: expected {"migration_name": ..., "sql": ...} on stdin, per ` +
      'migration_contract.schema.properties.up.\n'
    );
    process.exit(1);
  }
  return up;
}

// Reads migration_contract's "down" off stdin and validates its shape —
// shared by sandbox-down and production-down.
async function readDownPayload(command) {
  let down;
  try {
    down = JSON.parse(await readStdin());
  } catch (err) {
    process.stderr.write(`phase ${command}: stdin was not valid JSON: ${err.message}\n`);
    process.exit(1);
  }
  if (
    !down ||
    typeof down !== 'object' ||
    typeof down.migration_name !== 'string' ||
    typeof down.sql !== 'string'
  ) {
    process.stderr.write(
      `phase ${command}: expected {"migration_name": ..., "sql": ...} on stdin, per ` +
      'migration_contract.schema.properties.down.\n'
    );
    process.exit(1);
  }
  return down;
}

// Runs migration_contract's "up" through this repository's own migration
// tool — `prisma migrate deploy`, the same command the migrate stage and
// this application's own startup run — against `databaseUrl`, given a
// temporary copy of prisma/migrations/ with this one migration added, so
// this image's own copy of the repository is never written to (the same
// image rehearses the next migration, or applies the next one for real,
// afterwards). Shared by sandbox-up (databaseUrl points at the sandbox) and
// production-up (databaseUrl is DATABASE_URL itself), so the tool records
// the migration as applied exactly as it would if committed and deployed
// normally.
function applyMigrationUp(databaseUrl, up) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-up-'));
  try {
    const tmpPrisma = path.join(tmpRoot, 'prisma');
    fs.cpSync('/app/prisma', tmpPrisma, { recursive: true });

    const migrationDir = path.join(tmpPrisma, 'migrations', up.migration_name);
    fs.mkdirSync(migrationDir, { recursive: true });
    fs.writeFileSync(path.join(migrationDir, 'migration.sql'), up.sql);

    return spawnSync(
      'prisma',
      ['migrate', 'deploy', '--schema', path.join(tmpPrisma, 'schema.prisma')],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' }
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// Runs migration_contract's "down" against `conn`: the plain SQL that
// reverses "up" (see runSqlScript), followed
// by deleting the row "up" left in Prisma's own _prisma_migrations
// bookkeeping table (matched by migration_name) — so the tool's record ends
// up exactly as if the migration had never been applied, and a later apply
// of the same migration runs it again instead of finding it already done.
// Shared by sandbox-down (conn is connected to the sandbox) and
// production-down (conn is connected to the application's own database).
async function applyMigrationDown(conn, databaseUrl, down) {
  // The SQL runs through the tool's own script executor (see runSqlScript),
  // exactly as written, as one script.
  if (down.sql.trim().length > 0) {
    const result = runSqlScript(databaseUrl, down.sql);
    if (result.status !== 0) throw new Error(scriptFailure(result));
  }
  await conn.$executeRawUnsafe(
    'DELETE FROM `_prisma_migrations` WHERE `migration_name` = ?',
    down.migration_name
  );
}

// Runs migration_contract's "up" (a Prisma migration name + its SQL, read
// as JSON from stdin) through this repository's own migration tool, inside
// the sandbox `name` instead of production — see applyMigrationUp.
async function sandboxUp(name) {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase sandbox-up: ${err.message}\n`);
    process.exit(1);
  }

  validateSandboxName('sandbox-up', name, appDb);

  const up = await readUpPayload('sandbox-up');

  const result = applyMigrationUp(sandboxDatabaseUrl(name), up);
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
}

// Runs migration_contract's "up" against the application's own database —
// see applyMigrationUp. The tool records the migration as applied exactly
// as it would have if committed and deployed normally, so an application
// that migrates itself on startup finds it already applied rather than
// running it again.
async function productionUp() {
  try {
    parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase production-up: ${err.message}\n`);
    process.exit(1);
  }

  const up = await readUpPayload('production-up');

  const result = applyMigrationUp(process.env.DATABASE_URL, up);
  if (result.error) {
    process.stderr.write(`phase production-up: could not run prisma migrate deploy: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(
      `phase production-up: prisma migrate deploy failed:\n${(result.stdout || '') + (result.stderr || '')}`
    );
    process.exit(1);
  }
  process.exit(0);
}

// Runs migration_contract's "down" (plain SQL + the migration_name it
// applied, read as JSON from stdin) directly against the sandbox `name`'s
// database — see applyMigrationDown.
async function sandboxDown(name) {
  let appDb;
  try {
    appDb = parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase sandbox-down: ${err.message}\n`);
    process.exit(1);
  }
  validateSandboxName('sandbox-down', name, appDb);

  const down = await readDownPayload('sandbox-down');

  const conn = loadPrismaClient(sandboxDatabaseUrl(name));
  try {
    await applyMigrationDown(conn, sandboxDatabaseUrl(name), down);
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

// Runs migration_contract's "down" directly against the application's own
// database — see applyMigrationDown. This is the only place, besides
// production-up, that this program changes production; it never touches
// anything but what down.sql says and the one bookkeeping row it names.
async function productionDown() {
  try {
    parseAppDatabaseName();
  } catch (err) {
    process.stderr.write(`phase production-down: ${err.message}\n`);
    process.exit(1);
  }

  const down = await readDownPayload('production-down');

  const conn = loadPrismaClient();
  try {
    await applyMigrationDown(conn, process.env.DATABASE_URL, down);
    await conn.$disconnect();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`phase production-down: ${err.message || err}\n`);
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
} else if (args.length === 1 && args[0] === 'production-describe') {
  productionDescribe();
} else if (args.length === 1 && args[0] === 'production-up') {
  productionUp();
} else if (args.length === 1 && args[0] === 'production-down') {
  productionDown();
} else {
  process.stderr.write(
    `phase: does not implement ${JSON.stringify(args.join(' '))}; only "probe", ` +
    `"sandbox-build <name>", "sandbox-drop <name>", "sandbox-describe <name>", ` +
    `"sandbox-up <name>", "sandbox-down <name>", "production-describe", ` +
    `"production-up" and "production-down" are supported.\n`
  );
  process.exit(1);
}

