import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('测试数据库隔离', () => {
  it('测试进程绝不能指向业务数据库', () => {
    expect(process.env.DB_PATH).toBeTruthy();
    expect(path.resolve(process.env.DB_PATH)).not.toBe(path.resolve('./data/proxy.db'));
  });
});
