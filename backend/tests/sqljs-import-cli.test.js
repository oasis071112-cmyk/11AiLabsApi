import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createVerifiedBackup } = require('../scripts/backup-sqljs-control-plane.js');
const { parseImportArguments, verifyBackupManifest } = require('../scripts/import-sqljs-control-plane.js');

describe('SQL.js control-plane import CLI seam', () => {
  it('is dry-run by default and requires an explicit apply flag', () => {
    expect(parseImportArguments(['--source', 'legacy.db'])).toEqual({ sourcePath: 'legacy.db', backupManifestPath: undefined, apply: false });
    expect(parseImportArguments(['--source=legacy.db', '--backup-manifest=legacy.sha256.json', '--apply']))
      .toEqual({ sourcePath: 'legacy.db', backupManifestPath: 'legacy.sha256.json', apply: true });
    expect(() => parseImportArguments(['--source'])).toThrow('必须提供 SQL.js 源数据库路径');
    expect(() => parseImportArguments(['--backup-manifest'])).toThrow('必须提供已验证备份 manifest 路径');
  });

  it('requires an intact verified backup that exactly matches the import source', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-import-manifest-'));
    try {
      const source = path.join(root, 'proxy.db');
      fs.writeFileSync(source, Buffer.from('immutable legacy database snapshot'));
      const backup = createVerifiedBackup({
        source,
        destinationDirectory: path.join(root, 'backups'),
        now: new Date('2026-08-01T00:00:00.000Z'),
        apply: true,
      });

      expect(verifyBackupManifest({ manifestPath: backup.manifestPath, sourcePath: source })).toMatchObject({
        manifestPath: backup.manifestPath,
        backupPath: backup.backupPath,
        digest: backup.manifest.digest,
        bytes: backup.manifest.bytes,
      });

      fs.appendFileSync(source, 'changed-after-backup');
      expect(() => verifyBackupManifest({ manifestPath: backup.manifestPath, sourcePath: source }))
        .toThrow('源数据库或备份文件已在校验后发生变化');
      expect(() => verifyBackupManifest({ sourcePath: source })).toThrow('正式导入必须提供 --backup-manifest');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
