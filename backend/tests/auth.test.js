import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/database/init.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';
process.env.DB_PATH = './data/test-proxy.db';

const { generateToken } = await import('../src/middleware/auth.js');
const { authenticate } = await import('../src/middleware/auth.js');

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
});
