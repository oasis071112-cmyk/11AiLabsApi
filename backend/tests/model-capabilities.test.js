import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const adminRoutes = require('../src/routes/admin.js');
const userRoutes = require('../src/routes/user.js');
const publicRoutes = require('../src/routes/public.js');
const proxyRoutes = require('../src/routes/proxy.js');

describe('模型能力与图片请求边界', () => {
  let apiServer;
  let upstreamServer;
  let apiBaseUrl;
  let upstreamBaseUrl;
  let adminToken;
  let userToken;
  let apiKey;
  let visionModelId;
  let visionModelCode;

  beforeAll(async () => {
    upstreamServer = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      req.resume();
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          id: 'upstream-test-response',
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }));
      });
    });
    await new Promise(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
    upstreamBaseUrl = `http://127.0.0.1:${upstreamServer.address().port}/v1`;

    await initDatabase();
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const adminId = db.prepare('INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)')
      .run(`cap-admin-${suffix}`, `cap-admin-${suffix}@test.local`, bcrypt.hashSync('safe-pass', 4), 'admin', 'active').lastInsertRowid;
    const userId = db.prepare('INSERT INTO users (username,email,password_hash,role,status) VALUES (?,?,?,?,?)')
      .run(`cap-user-${suffix}`, `cap-user-${suffix}@test.local`, bcrypt.hashSync('safe-pass', 4), 'user', 'active').lastInsertRowid;
    db.prepare('INSERT INTO wallets (user_id,quota_balance,gift_quota) VALUES (?,?,?)').run(userId, 100, 0);

    visionModelCode = `vision-${suffix}`;
    visionModelId = db.prepare(`INSERT INTO models (
      model_code,model_name,upstream_model_name,model_type,is_multimodal,
      official_provider,official_currency,official_input_price,official_output_price,official_unit_tokens,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      visionModelCode, 'Vision model', 'vision-upstream', 'llm', 0,
      'openai', 'USD', 1, 2, 1000000, 'active',
    ).lastInsertRowid;
    const channelId = db.prepare('INSERT INTO upstream_channels (channel_name,base_url,api_key,status) VALUES (?,?,?,?)')
      .run(`cap-channel-${suffix}`, upstreamBaseUrl, 'upstream-test-key', 'active').lastInsertRowid;
    const groupId = db.prepare('INSERT INTO routing_groups (group_name,status) VALUES (?,?)')
      .run(`cap-group-${suffix}`, 'active').lastInsertRowid;
    db.prepare('INSERT INTO routing_group_channels (group_id,channel_id,status) VALUES (?,?,?)').run(groupId, channelId, 'active');
    db.prepare('INSERT INTO channel_models (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,?)')
      .run(channelId, visionModelCode, 'vision-upstream', 'active');

    apiKey = `sk-capability-${suffix}`;
    const apiKeyId = db.prepare(`INSERT INTO api_keys
      (user_id,key_hash,key_prefix,permission_mode,routing_group_id,status) VALUES (?,?,?,?,?,?)`).run(
      userId, bcrypt.hashSync(apiKey, 4), apiKey.substring(0, 12), 'group_dynamic', groupId, 'active',
    ).lastInsertRowid;
    db.prepare('INSERT INTO api_key_permissions (api_key_id,model_code,status) VALUES (?,?,?)')
      .run(apiKeyId, visionModelCode, 'active');

    adminToken = generateToken({ id: adminId, username: `cap-admin-${suffix}`, role: 'admin' });
    userToken = generateToken({ id: userId, username: `cap-user-${suffix}`, role: 'user' });

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/admin', adminRoutes);
    app.use('/api/user', userRoutes);
    app.use('/api/public', publicRoutes);
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

  it('文本模型收到图片时返回明确 400，且不会污染后续文本调用', async () => {
    const imageResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModelCode,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '请描述图片' },
          { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
        ] }],
      }),
    });

    expect(imageResponse.status).toBe(400);
    expect(await imageResponse.json()).toMatchObject({ error: { type: 'unsupported_content' } });

    const textResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(textResponse.status).toBe(200);
    expect(await textResponse.json()).toMatchObject({ choices: [{ message: { content: 'ok' } }] });
  });

  it('保存多模态能力后，管理端和用户端接口都返回布尔值 true', async () => {
    const updateResponse = await request(`/api/admin/models/${visionModelId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        model_name: 'Vision model', upstream_model_name: 'vision-upstream', model_type: 'llm',
        context_length: 128000, is_multimodal: true, description: '', status: 'active', sort_order: 0,
        official_provider: 'openai', official_model_id: visionModelCode, official_pricing_mode: 'auto',
        official_currency: 'USD', official_input_price: 1, official_cached_input_price: 1, official_output_price: 2,
      }),
    });
    expect(updateResponse.status).toBe(200);

    const adminModels = await request('/api/admin/models', { headers: { Authorization: `Bearer ${adminToken}` } }).then(response => response.json());
    const userModels = await request('/api/user/models', { headers: { Authorization: `Bearer ${userToken}` } }).then(response => response.json());
    expect(adminModels.data.find(model => model.model_code === visionModelCode).is_multimodal).toBe(true);
    expect(userModels.data.find(model => model.model_code === visionModelCode).is_multimodal).toBe(true);

    const imageResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModelCode,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '请描述图片' },
          { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
        ] }],
      }),
    });
    expect(imageResponse.status).toBe(200);
    expect(await imageResponse.json()).toMatchObject({ choices: [{ message: { content: 'ok' } }] });
  });
});
