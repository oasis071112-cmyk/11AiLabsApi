#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sha256File(filepath) {
  const digest = crypto.createHash('sha256');
  const descriptor = fs.openSync(filepath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest('hex');
}

function parseArguments(argumentsList) {
  const result = { apply: false, source: null, destinationDirectory: null };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--apply') { result.apply = true; continue; }
    const match = argument.match(/^--(source|destination)=(.+)$/);
    if (match) {
      result[match[1] === 'destination' ? 'destinationDirectory' : 'source'] = match[2];
      continue;
    }
    if (argument === '--source' || argument === '--destination') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} 必须提供路径`);
      result[argument === '--source' ? 'source' : 'destinationDirectory'] = value;
      index += 1;
      continue;
    }
    throw new Error(`不支持的参数 ${argument}`);
  }
  return result;
}

function backupPlan({ source, destinationDirectory, now = new Date() }) {
  if (!source) throw new Error('必须提供 SQL.js 源数据库路径');
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error('SQL.js 源数据库不存在或不是文件');
  const backupRoot = path.resolve(destinationDirectory || path.join(process.cwd(), 'backups/sqljs-control-plane'));
  const backupDirectory = path.join(backupRoot, timestamp(now));
  const backupPath = path.join(backupDirectory, path.basename(sourcePath));
  const manifestPath = `${backupPath}.sha256.json`;
  if (sourcePath === backupPath) throw new Error('备份目标不能与源数据库相同');
  return { sourcePath, backupRoot, backupDirectory, backupPath, manifestPath };
}

function createVerifiedBackup({ source, destinationDirectory, now = new Date(), apply = false } = {}) {
  const plan = backupPlan({ source, destinationDirectory, now });
  if (!apply) return { dryRun: true, ...plan };
  fs.mkdirSync(plan.backupDirectory, { recursive: true });
  if (fs.existsSync(plan.backupPath) || fs.existsSync(plan.manifestPath)) throw new Error('备份目标已存在，拒绝覆盖');
  const sourceHashBefore = sha256File(plan.sourcePath);
  fs.copyFileSync(plan.sourcePath, plan.backupPath, fs.constants.COPYFILE_EXCL);
  const sourceHashAfter = sha256File(plan.sourcePath);
  const backupHash = sha256File(plan.backupPath);
  if (sourceHashBefore !== sourceHashAfter || sourceHashBefore !== backupHash) {
    throw new Error('备份哈希校验失败；源库可能在复制期间发生写入');
  }
  const stats = fs.statSync(plan.backupPath);
  const manifest = {
    algorithm: 'sha256',
    digest: backupHash,
    bytes: stats.size,
    source: plan.sourcePath,
    backup: plan.backupPath,
    created_at: now.toISOString(),
    verified: true,
  };
  fs.writeFileSync(plan.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { dryRun: false, ...plan, manifest };
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const source = args.source || process.env.SQLJS_CONTROL_PLANE_SOURCE || './data/proxy.db';
  const destinationDirectory = args.destinationDirectory || process.env.SQLJS_BACKUP_DIRECTORY;
  if (args.apply && process.env.SQLJS_BACKUP_CONFIRM !== 'backup-and-verify') {
    throw new Error('拒绝执行备份：请设置 SQLJS_BACKUP_CONFIRM=backup-and-verify');
  }
  const result = createVerifiedBackup({ source, destinationDirectory, apply: args.apply });
  console.log(JSON.stringify(result, null, 2));
  if (result.dryRun) console.log('这是干跑预览；传入 --apply 并设置确认变量后才会复制。');
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`SQL.js 备份失败: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { backupPlan, createVerifiedBackup, parseArguments, sha256File, timestamp };
