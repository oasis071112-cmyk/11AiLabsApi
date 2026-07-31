#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveDatabaseUrl } = require('../src/infrastructure/postgres');

const BOOTSTRAP_FILENAME = '000_bootstrap.sql';
const MIGRATION_FILENAME = /^(\d{3,}_[a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_NAME = 'ionailabs-schema-migrations';

function discoverMigrations(migrationDirectory) {
  if (!fs.existsSync(migrationDirectory)) throw new Error(`Migration directory does not exist: ${migrationDirectory}`);
  const bootstrapPath = path.join(migrationDirectory, BOOTSTRAP_FILENAME);
  if (!fs.existsSync(bootstrapPath)) throw new Error(`Missing bootstrap migration: ${BOOTSTRAP_FILENAME}`);
  const migrations = fs.readdirSync(migrationDirectory)
    .map(filename => ({ filename, match: filename.match(MIGRATION_FILENAME) }))
    .filter(item => item.match && item.filename !== BOOTSTRAP_FILENAME)
    .map(item => ({
      version: item.match[1],
      filename: item.filename,
      filepath: path.join(migrationDirectory, item.filename),
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
  const duplicates = migrations.filter((migration, index) => index > 0 && migration.version === migrations[index - 1].version);
  if (duplicates.length) throw new Error(`Duplicate migration version: ${duplicates[0].version}`);
  return { bootstrapPath, migrations };
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseAppliedMigrations(stdout = '') {
  const applied = new Map();
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('\t');
    if (separator === -1) {
      throw new Error(`Invalid schema_migrations row: checksum is missing for ${line.trim()}`);
    }
    const version = line.slice(0, separator).trim();
    const checksum = line.slice(separator + 1).trim();
    if (!version || !checksum) {
      throw new Error(`Invalid schema_migrations row: version and checksum are required (${line.trim()})`);
    }
    applied.set(version, checksum);
  }
  return applied;
}

function parseAppliedVersions(stdout = '') {
  return new Set(
    String(stdout)
      .split(/\r?\n/)
      .map(value => value.split('\t', 1)[0].trim())
      .filter(Boolean),
  );
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stripMigrationEnvelope(source) {
  let body = String(source).replace(/^\uFEFF?[ \t]*BEGIN[ \t]*;[ \t]*(?:\r?\n)?/i, '');
  body = body.replace(/[ \t\r\n]*COMMIT[ \t]*;[ \t\r\n]*$/i, '');
  body = body.replace(
    /^[ \t]*INSERT[ \t]+INTO[ \t]+schema_migrations[ \t]*\([^)]+\)[ \t\r\n]*VALUES[ \t\r\n]*\([^;]+\)[ \t\r\n]*ON[ \t]+CONFLICT[ \t]*\([^)]+\)[ \t\r\n]*DO[ \t]+NOTHING[ \t]*;[ \t]*(?:\r?\n)?/gim,
    '',
  );
  return body.trim();
}

function buildSchemaMigrationsBootstrapSql() {
  return [
    'BEGIN;',
    `SELECT pg_advisory_xact_lock(hashtext(${sqlLiteral(MIGRATION_LOCK_NAME)}));`,
    'CREATE TABLE IF NOT EXISTS schema_migrations (',
    '  version TEXT PRIMARY KEY,',
    '  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    "  checksum TEXT NOT NULL DEFAULT ''",
    ');',
    'COMMIT;',
    '',
  ].join('\n');
}

function buildTransactionalMigrationSql({ version, checksum, source }) {
  const body = stripMigrationEnvelope(source);
  const guard = [
    'DO $migration_guard$',
    'DECLARE existing_checksum TEXT;',
    'BEGIN',
    `  SELECT sm.checksum INTO existing_checksum FROM schema_migrations sm WHERE sm.version = ${sqlLiteral(version)};`,
    '  IF FOUND THEN',
    `    IF existing_checksum <> ${sqlLiteral(checksum)} THEN`,
    `      RAISE EXCEPTION 'Migration checksum mismatch for ${version}';`,
    '    END IF;',
    `    RAISE EXCEPTION 'Migration ${version} was applied concurrently';`,
    '  END IF;',
    'END;',
    '$migration_guard$;',
  ].join('\n');
  return [
    'BEGIN;',
    `SELECT pg_advisory_xact_lock(hashtext(${sqlLiteral(MIGRATION_LOCK_NAME)}));`,
    guard,
    body,
    'INSERT INTO schema_migrations (version, checksum)',
    `VALUES (${sqlLiteral(version)}, ${sqlLiteral(checksum)})`,
    'ON CONFLICT (version) DO NOTHING;',
    'COMMIT;',
    '',
  ].join('\n');
}

function executeWithPsql({ databaseUrl, kind, file, sql, input, migration }) {
  const args = ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--dbname', databaseUrl];
  if (file && input !== undefined) throw new Error(`PostgreSQL ${kind}: file and input are mutually exclusive`);
  if (file) args.push('--file', file);
  if (input !== undefined) args.push('--file', '-');
  if (sql) args.push('--tuples-only', '--no-align', '--command', sql);
  const result = spawnSync('psql', args, { encoding: 'utf8', input });
  if (result.error) throw new Error(`Unable to execute psql (${kind}): ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`PostgreSQL ${kind} failed${migration ? ` (${migration.version})` : ''}: ${String(result.stderr || '').trim()}`);
  }
  return result;
}

function loadMigration(filepath, version) {
  const source = fs.readFileSync(filepath);
  return { version, source, checksum: sha256(source) };
}

function assertChecksum(applied, migration) {
  const stored = applied.get(migration.version);
  if (stored !== migration.checksum) {
    throw new Error(`Migration checksum mismatch for ${migration.version}: expected ${migration.checksum}, found ${stored || '<missing>'}`);
  }
}

function runPostgresMigrations({ databaseUrl, migrationDirectory, executePsql = executeWithPsql }) {
  if (!databaseUrl) throw new Error('POSTGRES_URL or DATABASE_URL must be set');
  const { bootstrapPath, migrations } = discoverMigrations(migrationDirectory);
  const bootstrap = loadMigration(bootstrapPath, '000_bootstrap');
  executePsql({
    kind: 'bootstrap',
    databaseUrl,
    input: buildSchemaMigrationsBootstrapSql(),
  });
  const applied = parseAppliedMigrations(executePsql({
    kind: 'read-applied',
    databaseUrl,
    sql: "SELECT version || E'\\t' || checksum FROM schema_migrations ORDER BY version",
  }).stdout);
  if (applied.has(bootstrap.version)) {
    assertChecksum(applied, bootstrap);
  } else {
    executePsql({
      kind: 'bootstrap-migration',
      databaseUrl,
      input: buildTransactionalMigrationSql({ ...bootstrap, source: bootstrap.source.toString('utf8') }),
      migration: { version: bootstrap.version, filepath: bootstrapPath, checksum: bootstrap.checksum },
    });
    applied.set(bootstrap.version, bootstrap.checksum);
  }

  const result = { applied: [], skipped: [] };
  for (const migration of migrations) {
    const loaded = { ...migration, ...loadMigration(migration.filepath, migration.version) };
    if (applied.has(migration.version)) {
      assertChecksum(applied, loaded);
      result.skipped.push(migration.version);
      continue;
    }
    executePsql({
      kind: 'migration',
      databaseUrl,
      input: buildTransactionalMigrationSql({ ...loaded, source: loaded.source.toString('utf8') }),
      migration: { version: loaded.version, filename: loaded.filename, filepath: loaded.filepath, checksum: loaded.checksum },
    });
    result.applied.push(migration.version);
  }
  return result;
}

function main() {
  const migrationDirectory = path.join(__dirname, '../migrations/postgres');
  if (!process.argv.includes('--apply')) {
    const { migrations } = discoverMigrations(migrationDirectory);
    console.log(JSON.stringify({ dryRun: true, pendingCandidates: migrations.map(item => item.version) }, null, 2));
    console.log('No database connection was made. Pass --apply to execute PostgreSQL migrations.');
    return;
  }
  const databaseUrl = resolveDatabaseUrl(process.env);
  console.log(JSON.stringify(runPostgresMigrations({ databaseUrl, migrationDirectory }), null, 2));
}

if (require.main === module) main();

module.exports = {
  BOOTSTRAP_FILENAME,
  discoverMigrations,
  sha256,
  parseAppliedMigrations,
  parseAppliedVersions,
  resolveMigrationDatabaseUrl: resolveDatabaseUrl,
  stripMigrationEnvelope,
  buildSchemaMigrationsBootstrapSql,
  buildTransactionalMigrationSql,
  runPostgresMigrations,
};
