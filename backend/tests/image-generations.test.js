import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const userRoutes = require('../src/routes/user.js');
const proxyRoutes = require('../src/routes/proxy.js');

describe('图片生成端点计费', () => {
  let apiServer;
  let upstreamServer;
  let apiBaseUrl;
  let apiKey;
  let apiKeyId;
  let userId;
  let userToken;
  let modelCode;
  let upstreamMode = 'images';

  beforeAll(async () => {
    upstreamServer = http.createServer((req, res) => {
      if (req.method !== 'POST' || !['/v1/images/generations', '/v1/responses'].includes(req.url)) {
        res.writeHead(404).end();
        return;
      }
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(upstreamMode === 'empty'
          ? { created: 1, data: [] }
          : req.url === '/v1/responses'
            ? {
              id: 'response-image-test',
              model: body.model,
              output: [{ type: 'image_generation_call', result: 'response-image' }],
            }
            : {
            created: 1,
            model: body.model,
            data: [{ b64_json: 'image-a' }, { url: 'https://example.test/image-b.png' }],
            }));
      });
    });
    await new Promise(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
    const upstreamBaseUrl = `http://127.0.0.1:${upstreamServer.address().port}/v1`;

    await initDatabase();
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    userId = db.prepare('INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)')
      .run(`image-user-${suffix}`, `image-user-${suffix}@test.local`, bcrypt.hashSync('safe-pass', 4), 'user', 'active').lastInsertRowid;
    db.prepare('INSERT INTO wallets (user_id,quota_balance,gift_quota) VALUES (?,?,?)').run(userId, 100, 0);
    modelCode = `image-model-${suffix}`;
    db.prepare(`INSERT INTO models (
      model_code,model_name,upstream_model_name,model_type,official_provider,official_currency,
      official_image_prices,billing_multiplier_image,status
    ) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      modelCode, 'Image model', 'upstream-image-model', 'image', 'openai', 'USD',
      JSON.stringify({ default: 0.04, '1024x1024': 0.04 }), 1.2, 'active',
    );
    const channelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,capabilities) VALUES (?,?,?,'active',?)`)
      .run(`image-channel-${suffix}`, upstreamBaseUrl, 'upstream-image-key', JSON.stringify(['image_generations', 'responses'])).lastInsertRowid;
    const groupId = db.prepare('INSERT INTO routing_groups (group_name,status) VALUES (?,?)')
      .run(`image-group-${suffix}`, 'active').lastInsertRowid;
    db.prepare("INSERT INTO routing_group_channels (group_id,channel_id,status) VALUES (?,?,'active')").run(groupId, channelId);
    db.prepare("INSERT INTO channel_models (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')")
      .run(channelId, modelCode, 'upstream-image-model');
    apiKey = `sk-image-${suffix}`;
    apiKeyId = db.prepare(`INSERT INTO api_keys
      (user_id,key_hash,key_prefix,permission_mode,routing_group_id,status) VALUES (?,?,?,?,?,'active')`)
      .run(userId, bcrypt.hashSync(apiKey, 4), apiKey.substring(0, 12), 'group_dynamic', groupId).lastInsertRowid;
    userToken = require('../src/middleware/auth.js').generateToken({
      id: userId, username: `image-user-${suffix}`, role: 'user',
    });

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/user', userRoutes);
    app.use('/v1', proxyRoutes);
    await new Promise(resolve => { apiServer = app.listen(0, '127.0.0.1', resolve); });
    apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  });

  afterAll(async () => {
    if (apiServer) await new Promise(resolve => apiServer.close(resolve));
    if (upstreamServer) await new Promise(resolve => upstreamServer.close(resolve));
  });

  async function request(path, options = {}) {
    return fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  }

  it('按上游实际返回张数结算并保存一条图片价格快照', async () => {
    const response = await request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelCode, prompt: 'draw', size: '1024x1024', n: 2 }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(2);
    const db = getDatabase();
    const log = db.prepare("SELECT * FROM api_request_logs WHERE api_key_id=? AND billing_mode='image' AND status='success' ORDER BY id DESC").get(apiKeyId);
    expect(log).toMatchObject({
      model_code: modelCode,
      billing_model: 'upstream-image-model',
      image_count: 2,
      image_size: '1024x1024',
      official_image_unit_price: 0.04,
      billing_multiplier_image: 1.2,
    });
    expect(log.total_cost).toBeCloseTo(0.672, 8);
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance)
      .toBeCloseTo(99.328, 8);

    const logsResponse = await request('/api/user/logs?limit=5', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const userLog = (await logsResponse.json()).data.find(item => item.request_id === log.request_id);
    expect(userLog.billing_detail).toMatchObject({ mode: 'image_snapshot', reconciled: true });
    expect(userLog).not.toHaveProperty('billing_model');
    expect(userLog.billing_detail.dimensions[0]).not.toHaveProperty('billingModel');
  });

  it('Responses 原生图片工具按实际 image_generation_call 结果计费', async () => {
    const response = await request('/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelCode,
        input: 'draw',
        tools: [{ type: 'image_generation', model: modelCode, size: '1024x1024' }],
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).output[0]).toMatchObject({ type: 'image_generation_call' });
    const log = getDatabase().prepare("SELECT * FROM api_request_logs WHERE api_key_id=? AND billing_mode='image' AND status='success' ORDER BY id DESC").get(apiKeyId);
    expect(log).toMatchObject({
      model_code: modelCode,
      billing_model: 'upstream-image-model',
      image_count: 1,
      image_size: '1024x1024',
    });
    expect(log.total_cost).toBeCloseTo(0.336, 8);
  });

  it('Responses 不允许绕过 API Key 权限指定其他图片模型', async () => {
    const response = await request('/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelCode,
        input: 'draw',
        tools: [{ type: 'image_generation', model: 'unauthorized-expensive-image-model' }],
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { type: 'unauthorized_image_model' } });
  });

  it('Responses 拒绝多个图片工具以避免模型与计费歧义', async () => {
    const response = await request('/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelCode,
        input: 'draw',
        tools: [
          { type: 'image_generation', model: modelCode },
          { type: 'image_generation', model: modelCode },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { type: 'multiple_image_generation_tools' } });
  });

  it('上游成功但没有有效图片时释放冻结额度且不扣费', async () => {
    upstreamMode = 'empty';
    const db = getDatabase();
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;
    const response = await request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelCode, prompt: 'draw empty', size: '1024x1024', n: 1 }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { type: 'empty_image_result' } });
    const wallet = db.prepare('SELECT quota_balance,frozen_balance FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.quota_balance).toBeCloseTo(before, 8);
    expect(wallet.frozen_balance).toBe(0);
    expect(db.prepare("SELECT billing_mode FROM api_request_logs WHERE api_key_id=? AND status='failed' ORDER BY id DESC").get(apiKeyId))
      .toMatchObject({ billing_mode: 'image' });
  });
});
