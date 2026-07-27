import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const userRoutes = require('../src/routes/user.js');

describe('用户调用记录筛选与 CSV 导出', () => {
  let server;
  let baseUrl;
  let userToken;
  let otherToken;
  let userId;
  let otherUserId;

  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const user = db.prepare('INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)')
      .run('logs-user', 'logs-user@test.local', bcrypt.hashSync('safe-pass', 4), 'user', 'active');
    const other = db.prepare('INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)')
      .run('logs-other', 'logs-other@test.local', bcrypt.hashSync('safe-pass', 4), 'user', 'active');
    userId = user.lastInsertRowid;
    otherUserId = other.lastInsertRowid;
    userToken = generateToken({ id: userId, username: 'logs-user', role: 'user' });
    otherToken = generateToken({ id: otherUserId, username: 'logs-other', role: 'user' });
    insertLog({ requestId: 'before-range', userId, model: 'model-a', createdAt: '2026-07-26 15:59:59' });
    insertLog({ requestId: 'range-start', userId, model: 'model-a', createdAt: '2026-07-26 16:00:00', totalCost: 0.123456, errorMessage: '=SUM(1,2)\n"quoted"' });
    insertLog({ requestId: 'range-model-b', userId, model: 'model-b', createdAt: '2026-07-27 10:00:00', status: 'failed' });
    insertLog({ requestId: 'range-end', userId, model: 'model-a', createdAt: '2026-07-27 15:59:59' });
    insertLog({ requestId: 'after-range', userId, model: 'model-a', createdAt: '2026-07-27 16:00:00' });
    insertLog({ requestId: 'other-user', userId: otherUserId, model: 'model-a', createdAt: '2026-07-27 08:00:00' });

    const app = express();
    app.use(express.json());
    app.use('/api/user', userRoutes);
    app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  function insertLog({ requestId, userId: targetUserId, model, createdAt, totalCost = 0.01, status = 'success', errorMessage = null }) {
    getDatabase().prepare(`INSERT INTO api_request_logs
      (request_id,user_id,model_code,input_tokens,cached_input_tokens,cache_creation_tokens,image_input_tokens,
       output_tokens,image_output_tokens,image_count,total_cost,status,error_type,error_message,latency_ms,billing_mode,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(requestId, targetUserId, model, 100, 10, 5, 2, 30, 1, 0, totalCost, status, status === 'failed' ? 'upstream' : null, errorMessage, 88, 'token', createdAt);
  }

  function request(path, token = userToken) {
    return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }

  it('按北京时间自然日边界、用户、模型稳定筛选并分页', async () => {
    const response = await request('/api/user/logs?start_date=2026-07-27&end_date=2026-07-27&model=model-a&page=1&limit=1');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pagination).toEqual({ page: 1, limit: 1, total: 2 });
    expect(payload.data.map(row => row.request_id)).toEqual(['range-end']);
    const second = await request('/api/user/logs?start_date=2026-07-27&end_date=2026-07-27&model=model-a&page=2&limit=1');
    expect((await second.json()).data.map(row => row.request_id)).toEqual(['range-start']);
  });

  it.each([
    '/api/user/logs?start_date=2026-07-27',
    '/api/user/logs?start_date=2026-02-30&end_date=2026-03-01',
    '/api/user/logs?start_date=2026-07-28&end_date=2026-07-27',
    '/api/user/logs?start_date=2026-01-01&end_date=2026-04-01',
    '/api/user/logs?page=0',
    '/api/user/logs?limit=101',
  ])('非法筛选返回 400: %s', async path => {
    expect((await request(path)).status).toBe(400);
  });

  it('导出全部命中结果并提供可审计 CSV', async () => {
    const response = await request('/api/user/logs/export?start_date=2026-07-27&end_date=2026-07-27&model=model-a');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('2026-07-27_2026-07-27.csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('请求 ID,时间（北京时间）,模型,计费方式');
    expect(csv).toContain('range-start,2026-07-27 00:00:00,model-a,Token');
    expect(csv).toContain('range-end,2026-07-27 23:59:59,model-a,Token');
    expect(csv).toContain("\"'=SUM(1,2)\n\"\"quoted\"\"\"");
    expect(csv).not.toContain('range-model-b');
    expect(csv).not.toContain('other-user');
    expect(csv).not.toContain('after-range');
  });

  it('导出要求完整日期、受认证保护且空结果仍有表头', async () => {
    expect((await request('/api/user/logs/export')).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/user/logs/export?start_date=2026-07-27&end_date=2026-07-27`)).status).toBe(401);
    const response = await request('/api/user/logs/export?start_date=2026-07-27&end_date=2026-07-27&model=missing', otherToken);
    const csv = await response.text();
    expect(csv.split('\r\n')).toHaveLength(1);
    expect(csv).toContain('请求 ID');
  });

  it('每日统计按北京时间自然日筛选和分组', async () => {
    const response = await request('/api/user/stats/daily?start_date=2026-07-27&end_date=2026-07-27');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ date: '2026-07-27', calls: 2, cost: 0.133456, input_tokens: 200, output_tokens: 60 }],
    });
  });

  it.each([
    '/api/user/stats/daily?start_date=2026-07-27',
    '/api/user/stats/daily?start_date=2026-02-30&end_date=2026-03-01',
    '/api/user/stats/daily?start_date=2026-07-28&end_date=2026-07-27',
  ])('每日统计拒绝非法日期范围: %s', async path => {
    expect((await request(path)).status).toBe(400);
  });
});
