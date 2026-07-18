import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getDatabase, initDatabase } = require('../src/database/init.js');
const authRoutes = require('../src/routes/auth.js');

describe('用户注册', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    await initDatabase();
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('注册会自动登录并创建钱包，但绝不创建默认 API Key', async () => {
    const username = `reg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'safe-pass-123' }),
    });

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message).toBe('注册成功，登录中...');
    expect(payload.token).toBeTruthy();
    expect(payload).not.toHaveProperty('api_key');

    const db = getDatabase();
    const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    expect(user).toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) AS count FROM wallets WHERE user_id=?').get(user.id).count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM api_keys WHERE user_id=?').get(user.id).count).toBe(0);
  });
});
