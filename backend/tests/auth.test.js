import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/database/init.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const { generateToken } = await import('../src/middleware/auth.js');
const { authenticate, findApiKey } = await import('../src/middleware/auth.js');

describe('认证模块', () => {
  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    // 确保测试用户存在
    const exists = db.prepare("SELECT id FROM users WHERE username='testuser'").get();
    if (!exists) {
      db.prepare("INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)")
        .run('testuser', 'test@test.com', bcrypt.hashSync('user123', 10), 'user', 'active');
    }
  });

  it('正确密码应生成有效 token', () => {
    const db = getDatabase();
    const user = db.prepare("SELECT * FROM users WHERE username='testuser'").get();
    expect(user).toBeTruthy();
    expect(bcrypt.compareSync('user123', user.password_hash)).toBe(true);
    const token = generateToken(user);
    expect(token).toBeTruthy();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.username).toBe('testuser');
  });

  it('错误密码应被 bcrypt 拒绝', () => {
    const db = getDatabase();
    const user = db.prepare("SELECT * FROM users WHERE username='testuser'").get();
    expect(bcrypt.compareSync('wrongpassword', user.password_hash)).toBe(false);
  });

  it('空 token 应失败', () => {
    expect(() => jwt.verify('', process.env.JWT_SECRET)).toThrow();
  });

  it('API Key 必须校验完整密钥，不能只依赖前缀', () => {
    const db = getDatabase();
    const user = db.prepare("SELECT * FROM users WHERE username='testuser'").get();
    const rawKey = 'sk-123456789-full-valid-key';
    const prefix = rawKey.substring(0, 12);
    db.prepare('DELETE FROM api_keys WHERE key_prefix=?').run(prefix);
    db.prepare("INSERT INTO api_keys (user_id,key_name,key_hash,key_prefix,status) VALUES (?,'测试密钥',?,?,'active')")
      .run(user.id, bcrypt.hashSync(rawKey, 10), prefix);

    expect(findApiKey(db, rawKey)).toBeTruthy();
    expect(findApiKey(db, `${prefix}-forged-key`)).toBeUndefined();
  });
});
