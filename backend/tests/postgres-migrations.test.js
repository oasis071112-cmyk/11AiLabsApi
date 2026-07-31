import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildTransactionalMigrationSql,
  resolveMigrationDatabaseUrl,
  runPostgresMigrations,
  sha256,
} = require('../scripts/migrate-postgres.js');

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('PostgreSQL migration runner seam', () => {
  it('shares the canonical DATABASE_URL resolver with the application runtime', () => {
    expect(resolveMigrationDatabaseUrl({ DATABASE_URL: 'postgresql://primary' })).toBe('postgresql://primary');
    expect(resolveMigrationDatabaseUrl({ POSTGRES_URL: 'postgresql://legacy' })).toBe('postgresql://legacy');
    expect(() => resolveMigrationDatabaseUrl({
      DATABASE_URL: 'postgresql://primary',
      POSTGRES_URL: 'postgresql://different',
    })).toThrow(/DATABASE_URL and POSTGRES_URL.*different/i);
  });

  it('bootstraps the version table and applies only migrations absent from it', () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-pg-migrations-'));
    temporaryDirectories.push(migrationDirectory);
    const sources = Object.fromEntries(
      ['000_bootstrap.sql', '001_control_plane.sql', '002_user_plane.sql'].map(filename => [
        filename,
        `BEGIN;\n-- ${filename}\nINSERT INTO schema_migrations (version, checksum)\nVALUES ('legacy', 'placeholder')\nON CONFLICT (version) DO NOTHING;\nCOMMIT;\n`,
      ]),
    );
    for (const [filename, source] of Object.entries(sources)) fs.writeFileSync(path.join(migrationDirectory, filename), source);
    const calls = [];
    const executePsql = request => {
      calls.push(request);
      return request.kind === 'read-applied' ? {
        stdout: `000_bootstrap\t${sha256(sources['000_bootstrap.sql'])}\n001_control_plane\t${sha256(sources['001_control_plane.sql'])}\n`,
      } : { stdout: '' };
    };

    const result = runPostgresMigrations({
      databaseUrl: 'postgresql://migration-test',
      migrationDirectory,
      executePsql,
    });

    expect(calls.map(call => call.kind)).toEqual(['bootstrap', 'read-applied', 'migration']);
    expect(calls.at(-1).migration).toMatchObject({
      version: '002_user_plane',
      filename: '002_user_plane.sql',
      checksum: sha256(sources['002_user_plane.sql']),
    });
    expect(calls.at(-1).input).toContain(`VALUES ('002_user_plane', '${sha256(sources['002_user_plane.sql'])}')`);
    expect(calls.at(-1).input).not.toContain("VALUES ('legacy', 'placeholder')");
    expect(calls.at(-1).input.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(calls.at(-1).input.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(result).toEqual({ applied: ['002_user_plane'], skipped: ['001_control_plane'] });
  });

  it('refuses to run when an applied migration file has drifted', () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-pg-migration-drift-'));
    temporaryDirectories.push(migrationDirectory);
    const bootstrap = '-- bootstrap\n';
    fs.writeFileSync(path.join(migrationDirectory, '000_bootstrap.sql'), bootstrap);
    fs.writeFileSync(path.join(migrationDirectory, '001_control_plane.sql'), '-- changed after apply\n');
    const calls = [];

    expect(() => runPostgresMigrations({
      databaseUrl: 'postgresql://migration-drift-test',
      migrationDirectory,
      executePsql: request => {
        calls.push(request);
        return request.kind === 'read-applied'
          ? { stdout: `000_bootstrap\t${sha256(bootstrap)}\n001_control_plane\told-checksum\n` }
          : { stdout: '' };
      },
    })).toThrow(/checksum mismatch for 001_control_plane/i);
    expect(calls.map(call => call.kind)).toEqual(['bootstrap', 'read-applied']);
  });

  it('persists a fresh bootstrap checksum before applying later migrations', () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-pg-bootstrap-checksum-'));
    temporaryDirectories.push(migrationDirectory);
    const bootstrap = 'BEGIN;\nCREATE TABLE IF NOT EXISTS example (id integer);\nCOMMIT;\n';
    fs.writeFileSync(path.join(migrationDirectory, '000_bootstrap.sql'), bootstrap);
    const calls = [];

    const result = runPostgresMigrations({
      databaseUrl: 'postgresql://bootstrap-test',
      migrationDirectory,
      executePsql: request => {
        calls.push(request);
        return { stdout: '' };
      },
    });

    expect(calls.map(call => call.kind)).toEqual(['bootstrap', 'read-applied', 'bootstrap-migration']);
    expect(calls.at(-1).input).toContain(`VALUES ('000_bootstrap', '${sha256(bootstrap)}')`);
    expect(calls.at(-1).input).toContain('CREATE TABLE IF NOT EXISTS example');
    expect(result).toEqual({ applied: [], skipped: [] });
  });

  it('plans all repository migrations for a fresh PostgreSQL version table without connecting to a database', () => {
    const calls = [];
    const migrationDirectory = path.resolve(import.meta.dirname, '../migrations/postgres');
    const bootstrapChecksum = sha256(fs.readFileSync(path.join(migrationDirectory, '000_bootstrap.sql')));
    const result = runPostgresMigrations({
      databaseUrl: 'postgresql://static-runner-test',
      migrationDirectory,
      executePsql: request => {
        calls.push(request);
        return request.kind === 'read-applied' ? { stdout: `000_bootstrap\t${bootstrapChecksum}\n` } : { stdout: '' };
      },
    });

    expect(result).toEqual({
      applied: ['001_foundation', '002_runtime_limits_and_billing', '003_public_api_compatibility', '004_api_key_daily_usage'],
      skipped: [],
    });
    expect(calls.map(call => call.kind)).toEqual([
      'bootstrap', 'read-applied', 'migration', 'migration', 'migration', 'migration',
    ]);
  });

  it('repackages repository migrations without nested outer transactions or placeholder checksums', () => {
    const migrationDirectory = path.resolve(import.meta.dirname, '../migrations/postgres');
    for (const filename of ['001_foundation.sql', '002_runtime_limits_and_billing.sql', '003_public_api_compatibility.sql', '004_api_key_daily_usage.sql']) {
      const source = fs.readFileSync(path.join(migrationDirectory, filename));
      const version = filename.replace(/\.sql$/, '');
      const sql = buildTransactionalMigrationSql({ version, checksum: sha256(source), source: source.toString('utf8') });

      expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
      expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
      expect(sql.match(/INSERT INTO schema_migrations/gi)).toHaveLength(1);
      expect(sql).toContain(`VALUES ('${version}', '${sha256(source)}')`);
    }
  });
});
