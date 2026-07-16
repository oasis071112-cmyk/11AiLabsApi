import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('测试数据库隔离', () => {
  it('测试进程使用系统临时目录中的数据库', () => {
    expect(process.env.DB_PATH).toBeTruthy();
    expect(path.resolve(process.env.DB_PATH).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true);
    expect(path.resolve(process.env.DB_PATH)).not.toBe(path.resolve('./data/proxy.db'));
  });

  it('测试进程指向业务数据库时拒绝加载数据库模块', () => {
    const result = spawnSync(process.execPath, ['-e', "require('./src/database/init.js')"], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', DB_PATH: path.resolve('./data/proxy.db') },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('测试环境拒绝使用业务数据库');
  });
});
