const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const POSTGRES_MIGRATION_FILENAME = /^\d{3,}_[a-z0-9_]+\.sql$/;

function resolvePg(pg) {
  if (pg) return pg;
  try {
    return require('pg');
  } catch (error) {
    throw new Error('PostgreSQL 驱动未安装；请安装 pg 后再创建连接池');
  }
}

function resolveDatabaseUrl(env = process.env, { required = true } = {}) {
  const databaseUrl = env?.DATABASE_URL;
  const legacyUrl = env?.POSTGRES_URL;
  if (databaseUrl && legacyUrl && databaseUrl !== legacyUrl) {
    throw new Error('DATABASE_URL and POSTGRES_URL are both set but different; DATABASE_URL is canonical');
  }
  const resolved = databaseUrl || legacyUrl || null;
  if (!resolved && required) throw new Error('DATABASE_URL must be set (POSTGRES_URL is accepted only for compatibility)');
  return resolved;
}

function createPostgresPool({ connectionString, env = process.env, pg, ...options } = {}) {
  const resolvedConnectionString = connectionString || resolveDatabaseUrl(env);
  const { Pool } = resolvePg(pg);
  if (typeof Pool !== 'function') throw new Error('PostgreSQL 驱动未提供 Pool');
  return new Pool({ connectionString: resolvedConnectionString, ...options });
}

function readPostgresMigrationManifest(migrationDirectory) {
  if (!migrationDirectory || !fs.existsSync(migrationDirectory)) {
    throw new Error(`PostgreSQL migration directory does not exist: ${migrationDirectory || '<missing>'}`);
  }
  const sqlFiles = fs.readdirSync(migrationDirectory)
    .filter(filename => filename.toLowerCase().endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  if (sqlFiles.length === 0) throw new Error(`PostgreSQL migration directory is empty: ${migrationDirectory}`);
  const invalid = sqlFiles.find(filename => !POSTGRES_MIGRATION_FILENAME.test(filename));
  if (invalid) throw new Error(`Invalid PostgreSQL migration filename: ${invalid}`);
  return sqlFiles.map(filename => {
    const bytes = fs.readFileSync(path.join(migrationDirectory, filename));
    return {
      version: filename.replace(/\.sql$/, ''),
      checksum: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });
}

async function inspectPostgresSchema(pool, { migrationDirectory } = {}) {
  const expected = readPostgresMigrationManifest(migrationDirectory);
  const result = await pool.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
  const applied = new Map((result.rows || []).map(row => [String(row.version), String(row.checksum)]));
  const expectedVersions = new Set(expected.map(item => item.version));
  const missing = expected.filter(item => !applied.has(item.version)).map(item => item.version);
  const mismatched = expected
    .filter(item => applied.has(item.version) && applied.get(item.version) !== item.checksum)
    .map(item => ({ version: item.version, expected: item.checksum, actual: applied.get(item.version) }));
  const unexpected = [...applied.keys()].filter(version => !expectedVersions.has(version)).sort();
  return {
    status: missing.length || mismatched.length || unexpected.length ? 'drift' : 'ok',
    expectedCount: expected.length,
    appliedCount: applied.size,
    missing,
    mismatched,
    unexpected,
  };
}

async function assertPostgresSchemaCurrent(pool, options) {
  const schema = await inspectPostgresSchema(pool, options);
  if (schema.status === 'ok') return schema;
  const reasons = [];
  if (schema.missing.length) reasons.push(`missing versions: ${schema.missing.join(', ')}`);
  if (schema.mismatched.length) reasons.push(`checksum mismatch: ${schema.mismatched.map(item => item.version).join(', ')}`);
  if (schema.unexpected.length) reasons.push(`unexpected versions: ${schema.unexpected.join(', ')}`);
  throw new Error(`PostgreSQL schema is not current (${reasons.join('; ')}). Run the explicit migration command before startup.`);
}

async function ensureApiRequestLogPartitions(pool, { monthsAhead = 3 } = {}) {
  if (!Number.isInteger(monthsAhead) || monthsAhead < 3 || monthsAhead > 24) {
    throw new Error('monthsAhead must be an integer between 3 and 24');
  }
  const result = await pool.query(`
    SELECT ensure_api_request_logs_partition(
      (date_trunc('month', CURRENT_DATE) + make_interval(months => month_offset))::date
    ) AS partition_name
    FROM generate_series(0, $1::integer) AS month_offset
  `, [monthsAhead]);
  return { monthsProvisioned: monthsAhead + 1, partitions: (result.rows || []).map(row => row.partition_name) };
}

async function inspectCurrentRequestLogPartition(pool) {
  const result = await pool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_inherits inheritance
        JOIN pg_class parent_table ON parent_table.oid = inheritance.inhparent
        JOIN pg_class child_table ON child_table.oid = inheritance.inhrelid
        WHERE parent_table.relname = 'api_request_logs'
          AND child_table.relname = 'api_request_logs_' || to_char(CURRENT_DATE, 'YYYY_MM')
      ) AS attached,
      'api_request_logs_' || to_char(CURRENT_DATE, 'YYYY_MM') AS partition_name
  `);
  const row = result.rows?.[0] || {};
  const attached = row.attached === true || row.attached === 't';
  return {
    status: attached ? 'ok' : 'missing',
    attached,
    partitionName: row.partition_name || null,
  };
}

async function checkPostgresSchema(pool, options) {
  try {
    const [schema, currentPartition] = await Promise.all([
      inspectPostgresSchema(pool, options),
      inspectCurrentRequestLogPartition(pool),
    ]);
    return {
      ...schema,
      status: schema.status === 'ok' && currentPartition.status === 'ok' ? 'ok' : 'drift',
      currentPartition,
    };
  } catch (_error) {
    return {
      status: 'down',
      missing: [],
      mismatched: [],
      unexpected: [],
      currentPartition: { status: 'unknown', attached: false, partitionName: null },
    };
  }
}

async function withTransaction(pool, action) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('PostgreSQL 连接池必须提供 connect()');
  if (typeof action !== 'function') throw new Error('事务必须提供执行函数');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { /* 保留原始失败 */ }
    throw error;
  } finally {
    client.release();
  }
}

async function checkPostgres(pool) {
  const startedAt = Date.now();
  try {
    await pool.query('SELECT 1 AS ok');
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - startedAt };
  }
}

module.exports = {
  assertPostgresSchemaCurrent,
  checkPostgres,
  checkPostgresSchema,
  createPostgresPool,
  ensureApiRequestLogPartitions,
  inspectCurrentRequestLogPartition,
  inspectPostgresSchema,
  readPostgresMigrationManifest,
  resolveDatabaseUrl,
  withTransaction,
};
