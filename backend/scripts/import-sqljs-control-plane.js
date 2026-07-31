#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createPostgresPool, withTransaction } = require('../src/infrastructure/postgres');
const { createSecretBox } = require('../src/infrastructure/versioned-secret');
const { decrypt: decryptLegacySecret } = require('../src/utils/crypto');
const { sha256File } = require('./backup-sqljs-control-plane');
const {
  createPostgresControlPlaneSink,
  executeControlPlaneImport,
  loadSqlJsControlPlaneSnapshot,
} = require('../src/infrastructure/sqljs-control-plane-import');

function parseImportArguments(argumentsList) {
  let sourcePath;
  let backupManifestPath;
  let apply = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--source') {
      const nextValue = argumentsList[index + 1];
      if (!nextValue || nextValue.startsWith('--')) throw new Error('必须提供 SQL.js 源数据库路径');
      sourcePath = nextValue;
      index += 1;
      continue;
    }
    if (argument.startsWith('--source=')) {
      sourcePath = argument.slice('--source='.length);
      if (!sourcePath) throw new Error('必须提供 SQL.js 源数据库路径');
      continue;
    }
    if (argument === '--backup-manifest') {
      const nextValue = argumentsList[index + 1];
      if (!nextValue || nextValue.startsWith('--')) throw new Error('必须提供已验证备份 manifest 路径');
      backupManifestPath = nextValue;
      index += 1;
      continue;
    }
    if (argument.startsWith('--backup-manifest=')) {
      backupManifestPath = argument.slice('--backup-manifest='.length);
      if (!backupManifestPath) throw new Error('必须提供已验证备份 manifest 路径');
      continue;
    }
    throw new Error(`不支持的参数 ${argument}`);
  }
  return { sourcePath, backupManifestPath, apply };
}

function verifyBackupManifest({ manifestPath, sourcePath }) {
  if (!manifestPath) throw new Error('正式导入必须提供 --backup-manifest，且该文件必须由备份命令生成');
  const resolvedManifestPath = path.resolve(manifestPath);
  const resolvedSourcePath = path.resolve(sourcePath);
  let manifest;
  try {
    const stats = fs.statSync(resolvedManifestPath);
    if (!stats.isFile() || stats.size > 64 * 1024) throw new Error('manifest 不是有效的小型文件');
    manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取备份 manifest: ${error.message}`);
  }
  if (manifest?.algorithm !== 'sha256' || manifest?.verified !== true || !/^[a-f0-9]{64}$/i.test(String(manifest?.digest || ''))) {
    throw new Error('备份 manifest 未声明有效的 SHA-256 校验结果');
  }
  if (!manifest.source || path.resolve(manifest.source) !== resolvedSourcePath) {
    throw new Error('备份 manifest 与本次导入源数据库不匹配');
  }
  if (!manifest.backup) throw new Error('备份 manifest 缺少备份文件路径');
  const backupPath = path.resolve(manifest.backup);
  if (backupPath === resolvedSourcePath) throw new Error('备份文件必须与源数据库分离');
  let backupStats;
  try {
    backupStats = fs.statSync(backupPath);
  } catch (_error) {
    throw new Error('备份 manifest 指向的备份文件不存在');
  }
  if (!backupStats.isFile() || backupStats.size !== Number(manifest.bytes)) {
    throw new Error('备份文件大小与 manifest 不一致');
  }
  const sourceDigest = sha256File(resolvedSourcePath);
  const backupDigest = sha256File(backupPath);
  const expectedDigest = String(manifest.digest).toLowerCase();
  if (sourceDigest !== expectedDigest || backupDigest !== expectedDigest) {
    throw new Error('源数据库或备份文件已在校验后发生变化，拒绝正式导入');
  }
  return {
    manifestPath: resolvedManifestPath,
    backupPath,
    digest: expectedDigest,
    bytes: backupStats.size,
    createdAt: manifest.created_at || null,
  };
}

function secretBoxFromEnvironment() {
  const activeVersion = process.env.INFRA_SECRET_ACTIVE_VERSION;
  const rawKeyring = process.env.INFRA_SECRET_KEYRING;
  if (!activeVersion || !rawKeyring) {
    throw new Error('正式导入需要 INFRA_SECRET_ACTIVE_VERSION 和 INFRA_SECRET_KEYRING');
  }
  try {
    return createSecretBox({ activeVersion, keys: JSON.parse(rawKeyring) });
  } catch (error) {
    throw new Error(`无法读取导入密钥环: ${error.message}`);
  }
}

async function main() {
  const { sourcePath: sourceArgument, backupManifestPath: manifestArgument, apply } = parseImportArguments(process.argv.slice(2));
  const sourcePath = path.resolve(sourceArgument || process.env.SQLJS_CONTROL_PLANE_SOURCE || './data/proxy.db');
  if (!apply) {
    const snapshot = await loadSqlJsControlPlaneSnapshot({ sourcePath });
    const result = await executeControlPlaneImport({ snapshot });
    console.log(JSON.stringify({ sourcePath, ...result }, null, 2));
    console.log('这是干跑预览；未写入 PostgreSQL。正式导入还必须提供已验证备份 manifest。');
    return;
  }
  if (process.env.CONTROL_PLANE_IMPORT_CONFIRM !== 'apply-control-plane') {
    throw new Error('拒绝正式导入：请设置 CONTROL_PLANE_IMPORT_CONFIRM=apply-control-plane');
  }
  const backupVerification = verifyBackupManifest({
    manifestPath: manifestArgument || process.env.SQLJS_CONTROL_PLANE_BACKUP_MANIFEST,
    sourcePath,
  });
  // Import the verified backup, not the mutable live SQL.js file. This makes the
  // backup boundary the exact source of truth for the migration transaction.
  const snapshot = await loadSqlJsControlPlaneSnapshot({ sourcePath: backupVerification.backupPath });
  const pool = createPostgresPool();
  try {
    const result = await withTransaction(pool, client => executeControlPlaneImport({
      snapshot,
      dryRun: false,
      secretBox: secretBoxFromEnvironment(),
      decodePaymentSecret: decryptLegacySecret,
      sink: createPostgresControlPlaneSink(client),
      importedBy: process.env.INFRA_IMPORT_ACTOR || 'sqljs-control-plane-import',
    }));
    console.log(JSON.stringify({ sourcePath, backupVerification, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`SQL.js 控制面导入失败: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseImportArguments,
  secretBoxFromEnvironment,
  verifyBackupManifest,
};
