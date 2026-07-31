import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createVerifiedBackup, parseArguments, sha256File } = require('../scripts/backup-sqljs-control-plane.js');
const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('SQL.js verified backup seam', () => {
  it('is dry-run by default and makes no destination directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-sqljs-backup-'));
    temporaryDirectories.push(root);
    const source = path.join(root, 'proxy.db');
    const destination = path.join(root, 'backups');
    fs.writeFileSync(source, 'safe-control-plane-snapshot');

    const result = createVerifiedBackup({
      source, destinationDirectory: destination, now: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(result.dryRun).toBe(true);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('copies without overwriting and records a matching SHA-256 manifest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-sqljs-backup-'));
    temporaryDirectories.push(root);
    const source = path.join(root, 'proxy.db');
    fs.writeFileSync(source, Buffer.from('control-plane-with-no-user-export'));

    const result = createVerifiedBackup({
      source,
      destinationDirectory: path.join(root, 'backups'),
      now: new Date('2026-08-01T00:00:00.000Z'),
      apply: true,
    });

    expect(result.manifest).toMatchObject({ algorithm: 'sha256', digest: sha256File(source), verified: true });
    expect(sha256File(result.backupPath)).toBe(sha256File(source));
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'))).toEqual(result.manifest);
    expect(() => createVerifiedBackup({
      source,
      destinationDirectory: path.join(root, 'backups'),
      now: new Date('2026-08-01T00:00:00.000Z'),
      apply: true,
    })).toThrow(/拒绝覆盖/);
  });

  it('accepts explicit source and destination arguments only', () => {
    expect(parseArguments(['--source', 'old.db', '--destination=backups'])).toEqual({
      apply: false, source: 'old.db', destinationDirectory: 'backups',
    });
    expect(() => parseArguments(['--unknown'])).toThrow(/不支持/);
  });
});
