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
  let channelId;
  let groupId;
  let upstreamMode = 'normal';

  beforeAll(async () => {
    upstreamServer = http.createServer((req, res) => {
      if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/embeddings'].includes(req.url)) {
        res.writeHead(404).end();
        return;
      }
      let rawBody = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { rawBody += chunk; });
      req.on('end', async () => {
        const requestBody = JSON.parse(rawBody || '{}');
        if (req.url === '/v1/embeddings') {
          if (upstreamMode === 'reject-primary-embedding' && req.headers.authorization === 'Bearer upstream-test-key') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'primary embedding rejected' } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ object: 'embedding', index: 0, embedding: [0.1] }], usage: { prompt_tokens: 3, total_tokens: 3 } }));
          return;
        }
        const hasImage = JSON.stringify(requestBody.messages || requestBody.input || '').includes('image_url');
        if (upstreamMode === 'delayed') await new Promise(resolve => setTimeout(resolve, 120));
        if (upstreamMode === 'reject-image' && hasImage) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'image payload rejected by upstream' } }));
          return;
        }
        if (requestBody.stream === true) {
          const contentChunk = upstreamMode === 'reasoning-only'
            ? { choices: [{ delta: { reasoning_content: '可见回答' } }] }
            : { choices: [{ delta: { content: '图片已识别' } }] };
          const usageChunk = { choices: [], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } };
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          // SSE 规范允许 data: 后不带空格；代理必须兼容这种合法格式。
          const events = upstreamMode === 'stream-without-usage'
            ? [contentChunk]
            : [contentChunk, usageChunk];
          res.end(`${events.map(event => `data:${JSON.stringify(event)}\r\n\r\n`).join('')}data:[DONE]\r\n\r\n`);
          return;
        }
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
    channelId = db.prepare('INSERT INTO upstream_channels (channel_name,base_url,api_key,status) VALUES (?,?,?,?)')
      .run(`cap-channel-${suffix}`, upstreamBaseUrl, 'upstream-test-key', 'active').lastInsertRowid;
    groupId = db.prepare('INSERT INTO routing_groups (group_name,status) VALUES (?,?)')
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

  it('旧版模型更新未提交图片字段时保留已有图片价格与倍率', async () => {
    const db = getDatabase();
    const imagePrices = JSON.stringify({ default: 0.5, '1024x1024': 0.5 });
    db.prepare('UPDATE models SET official_image_prices=?,billing_multiplier_image=? WHERE id=?')
      .run(imagePrices, 1.7, visionModelId);
    const response = await request(`/api/admin/models/${visionModelId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        model_name: 'Vision model',
        upstream_model_name: 'vision-upstream',
        model_type: 'llm',
        context_length: 128000,
        is_multimodal: false,
        official_provider: 'openai',
        official_model_id: visionModelCode,
        official_pricing_mode: 'manual',
        official_currency: 'USD',
        official_input_price: 1,
        official_cached_input_price: 0.5,
        official_output_price: 2,
        multiplier_input: 1,
        multiplier_output: 1,
        status: 'active',
        sort_order: 0,
      }),
    });

    expect(response.status).toBe(200);
    const saved = db.prepare('SELECT official_image_prices,billing_multiplier_image FROM models WHERE id=?').get(visionModelId);
    expect(saved.billing_multiplier_image).toBe(1.7);
    expect(JSON.parse(saved.official_image_prices)).toMatchObject({ default: 0.5, '1024x1024': 0.5 });
  });

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
    expect(await imageResponse.json()).toMatchObject({ error: { type: 'model_capability_unavailable' } });

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

    const disableChannelVision = await request(`/api/admin/channels/${channelId}/models`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ models: [{
        model_code: visionModelCode,
        upstream_model_name: 'vision-upstream',
        supports_image_input: false,
      }] }),
    });
    expect(disableChannelVision.status).toBe(200);
    const disabledModelList = await request('/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }).then(response => response.json());
    expect(disabledModelList.data.find(item => item.id === visionModelCode).capabilities.image_input).toBe(false);
    const disabledUserModels = await request('/api/user/models', { headers: { Authorization: `Bearer ${userToken}` } }).then(response => response.json());
    expect(disabledUserModels.data.find(item => item.model_code === visionModelCode)).toMatchObject({ supports_image_input: false });

    const rejectedByChannel = await request('/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModelCode,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] }],
      }),
    });
    expect(rejectedByChannel.status).toBe(400);
    expect(await rejectedByChannel.json()).toMatchObject({ error: { type: 'model_capability_unavailable' } });

    const enableChannelVision = await request(`/api/admin/channels/${channelId}/models`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ models: [{
        model_code: visionModelCode,
        upstream_model_name: 'vision-upstream',
        supports_image_input: true,
      }] }),
    });
    expect(enableChannelVision.status).toBe(200);
    const enabledModelList = await request('/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }).then(response => response.json());
    expect(enabledModelList.data.find(item => item.id === visionModelCode).capabilities).toMatchObject({ chat_completions: true, image_input: true });
    const enabledUserModels = await request('/api/user/models', { headers: { Authorization: `Bearer ${userToken}` } }).then(response => response.json());
    expect(enabledUserModels.data.find(item => item.model_code === visionModelCode)).toMatchObject({ supports_image_input: true });

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

  it('大 Base64 图片不应按传输文本预估额度，最终按上游真实 usage 结算', async () => {
    const db = getDatabase();
    const userId = db.prepare('SELECT user_id FROM api_keys WHERE key_prefix=?').get(apiKey.substring(0, 12)).user_id;
    db.prepare('UPDATE wallets SET quota_balance=?, gift_quota=0, frozen_balance=0 WHERE user_id=?').run(0.1, userId);

    const response = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModelCode,
        max_tokens: 1,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '请描述图片' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(60000)}`, detail: 'low' } },
        ] }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ usage: { prompt_tokens: 5, completion_tokens: 2 } });
    const wallet = db.prepare('SELECT quota_balance, frozen_balance, total_spent FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.frozen_balance).toBe(0);
    expect(wallet.quota_balance).toBeLessThan(0.1);
    expect(wallet.total_spent).toBeGreaterThan(0);
    db.prepare('UPDATE wallets SET quota_balance=100, gift_quota=0, frozen_balance=0 WHERE user_id=?').run(userId);
  });

  it('对话请求使用渠道的 Sub2API 每 token 美元价格结算', async () => {
    const db = getDatabase();
    db.prepare(`UPDATE channel_models SET
      billing_mode='token',billing_model_source='upstream',input_price=?,output_price=?
      WHERE channel_id=? AND model_code=?`).run(0.000003, 0.000008, channelId, visionModelCode);
    const response = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: 'priced chat' }] }),
    });

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    const log = db.prepare("SELECT * FROM api_request_logs WHERE model_code=? AND status='success' ORDER BY id DESC").get(visionModelCode);
    expect(log).toMatchObject({
      billing_mode: 'token',
      input_tokens: 5,
      output_tokens: 2,
    });
    expect(log.total_cost).toBeCloseTo(0.000217, 10);
    db.prepare(`UPDATE channel_models SET
      billing_mode='',billing_model_source='channel_mapped',input_price=NULL,output_price=NULL
      WHERE channel_id=? AND model_code=?`).run(channelId, visionModelCode);
  });

  it('对话渠道 per_request 模式按一次固定价格结算且不新增订阅', async () => {
    const db = getDatabase();
    db.prepare(`UPDATE channel_models SET
      billing_mode='per_request',per_request_price=?,input_price=NULL,output_price=NULL
      WHERE channel_id=? AND model_code=?`).run(0.12, channelId, visionModelCode);

    const response = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: 'fixed price chat' }] }),
    });

    expect(response.status).toBe(200);
    const log = db.prepare("SELECT * FROM api_request_logs WHERE model_code=? AND status='success' ORDER BY id DESC").get(visionModelCode);
    expect(log.billing_mode).toBe('per_request');
    expect(log.total_cost).toBeCloseTo(0.84, 10);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%subscription%'").all()).toEqual([]);
    const userLogs = await request('/api/user/logs?limit=100', {
      headers: { Authorization: `Bearer ${userToken}` },
    }).then(result => result.json());
    expect(userLogs.data.find(item => item.request_id === log.request_id).billing_detail)
      .toMatchObject({ mode: 'fixed_snapshot', reconciled: true, actualTotal: 0.84 });

    db.prepare(`UPDATE channel_models SET billing_mode='',per_request_price=NULL
      WHERE channel_id=? AND model_code=?`).run(channelId, visionModelCode);
  });

  it('billing_model_source=channel_mapped 时使用映射模型的价格结算', async () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO models (
      model_code,model_name,model_type,official_currency,official_input_price,official_output_price,
      official_unit_tokens,status
    ) VALUES (?,?,?,'USD',?,?,1000000,'active')`)
      .run('vision-upstream', 'Mapped billing price', 'llm', 10, 20);
    db.prepare(`UPDATE channel_models SET billing_model_source='channel_mapped',billing_mode=''
      WHERE channel_id=? AND model_code=?`).run(channelId, visionModelCode);

    const response = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: 'mapped price' }] }),
    });
    expect(response.status).toBe(200);
    const log = db.prepare("SELECT * FROM api_request_logs WHERE model_code=? AND status='success' ORDER BY id DESC").get(visionModelCode);
    expect(log.billing_model).toBe('vision-upstream');
    expect(log.total_cost).toBeCloseTo(0.00063, 10);

    db.prepare('DELETE FROM models WHERE model_code=?').run('vision-upstream');
  });

  it('只把对话请求路由到声明支持 chat_completions 的渠道', async () => {
    const channelPayload = capabilities => ({
      channel_name: 'cap-channel-capability-test',
      base_url: upstreamBaseUrl,
      api_key: '',
      priority: 0,
      weight: 100,
      protocol_type: 'openai_compatible',
      capabilities,
    });
    const disableChat = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(channelPayload(['embeddings'])),
    });
    expect(disableChat.status).toBe(200);

    const blocked = await request('/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: '你好' }] }),
    });
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: { type: 'no_channel' } });

    const enableChat = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(channelPayload(['chat_completions', 'embeddings'])),
    });
    expect(enableChat.status).toBe(200);
    const channels = await request('/api/admin/channels', { headers: { Authorization: `Bearer ${adminToken}` } });
    const saved = (await channels.json()).data.find(item => item.id === channelId);
    expect(saved.capabilities).toEqual(['chat_completions', 'embeddings']);

    const legacyUpdate = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel_name: 'cap-channel-legacy-update', base_url: upstreamBaseUrl, api_key: '',
        priority: 0, weight: 100, protocol_type: 'openai_compatible',
      }),
    });
    expect(legacyUpdate.status).toBe(200);
    const afterLegacyUpdate = await request('/api/admin/channels', { headers: { Authorization: `Bearer ${adminToken}` } }).then(response => response.json());
    expect(afterLegacyUpdate.data.find(item => item.id === channelId).capabilities).toEqual(['chat_completions', 'embeddings']);

    const invalidUpdate = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel_name: 'cap-channel-invalid-update', base_url: upstreamBaseUrl, api_key: '',
        priority: 0, weight: 100, protocol_type: 'openai_compatible', capabilities: ['unknown'],
      }),
    });
    expect(invalidUpdate.status).toBe(400);
  });

  it('并发请求只冻结各自预算，不会由首个请求占满钱包', async () => {
    upstreamMode = 'delayed';
    const payload = {
      model: visionModelCode,
      max_tokens: 32,
      messages: [{ role: 'user', content: '并发测试' }],
    };
    const [first, second] = await Promise.all([
      request('/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) }),
      request('/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) }),
    ]);
    upstreamMode = 'normal';
    expect([first.status, second.status]).toEqual([200, 200]);
  });

  it('向量请求和故障转移都不会选择仅支持对话的渠道', async () => {
    const updateCapabilities = capabilities => request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel_name: 'cap-channel-embedding-test', base_url: upstreamBaseUrl, api_key: '',
        priority: 0, weight: 100, protocol_type: 'openai_compatible', capabilities,
      }),
    });
    expect((await updateCapabilities(['chat_completions'])).status).toBe(200);
    const blocked = await request('/v1/embeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, input: '你好' }),
    });
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: { type: 'no_channel' } });

    expect((await updateCapabilities(['chat_completions', 'embeddings'])).status).toBe(200);
    const allowed = await request('/v1/embeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, input: '你好' }),
    });
    expect(allowed.status).toBe(200);

    const db = getDatabase();
    const fallbackChannelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,capabilities) VALUES (?,?,?,'active',?)`)
      .run('chat-only-fallback', upstreamBaseUrl, 'fallback-test-key', JSON.stringify(['chat_completions'])).lastInsertRowid;
    db.prepare("INSERT INTO routing_group_channels (group_id,channel_id,priority,weight,status) VALUES (?,?,1,100,'active')")
      .run(groupId, fallbackChannelId);
    db.prepare("INSERT INTO channel_models (channel_id,model_code,upstream_model_name,supports_image_input,status) VALUES (?,?,?,?, 'active')")
      .run(fallbackChannelId, visionModelCode, 'vision-upstream', 0);

    upstreamMode = 'reject-primary-embedding';
    const failedWithoutInvalidFallback = await request('/v1/embeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, input: '不得切到对话渠道' }),
    });
    upstreamMode = 'normal';
    expect(failedWithoutInvalidFallback.status).toBe(401);
    expect(await failedWithoutInvalidFallback.json()).toMatchObject({ error: { type: 'upstream_error' } });
    db.prepare('UPDATE upstream_channels SET health_score=100,consecutive_failures=0,circuit_breaker_until=NULL WHERE id=?').run(channelId);
  });

  it('管理员可删除未引用的渠道和分组，但不能删除仍在服务中的配置', async () => {
    const createChannel = await request('/api/admin/channels', {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel_name: 'unused-delete-channel', base_url: upstreamBaseUrl, api_key: 'unused-key',
        priority: 0, weight: 100, protocol_type: 'openai_compatible', capabilities: ['chat_completions'],
      }),
    });
    expect(createChannel.status).toBe(201);
    const channels = await request('/api/admin/channels', { headers: { Authorization: `Bearer ${adminToken}` } }).then(response => response.json());
    const unusedChannel = channels.data.find(item => item.channel_name === 'unused-delete-channel');
    expect((await request(`/api/admin/channels/${unusedChannel.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } })).status).toBe(200);

    const createGroup = await request('/api/admin/routing-groups', {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ group_name: 'unused-delete-group', status: 'inactive', channels: [], model_codes: [] }),
    });
    expect(createGroup.status).toBe(201);
    const unusedGroupId = (await createGroup.json()).id;
    expect((await request(`/api/admin/routing-groups/${unusedGroupId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } })).status).toBe(200);
    expect((await request(`/api/admin/routing-groups/${unusedGroupId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } })).status).toBe(404);

    const fallbackGroup = await request('/api/admin/routing-groups', {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ group_name: 'protected-fallback-group', status: 'active', channels: [], model_codes: [] }),
    });
    const fallbackGroupId = (await fallbackGroup.json()).id;
    const db = getDatabase();
    db.prepare('UPDATE routing_groups SET fallback_group_id=? WHERE id=(SELECT routing_group_id FROM api_keys WHERE key_prefix=? LIMIT 1)')
      .run(fallbackGroupId, apiKey.substring(0, 12));
    expect((await request(`/api/admin/routing-groups/${fallbackGroupId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } })).status).toBe(409);
    db.prepare('UPDATE routing_groups SET fallback_group_id=NULL WHERE fallback_group_id=?').run(fallbackGroupId);

    expect((await request(`/api/admin/channels/${channelId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } })).status).toBe(409);
  });

  it('把兼容上游的 reasoning-only 流归一为客户端可显示的 content', async () => {
    upstreamMode = 'reasoning-only';
    const response = await request('/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, stream: true, messages: [{ role: 'user', content: '你好' }] }),
    });
    upstreamMode = 'normal';
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"content":"可见回答"');
    expect(body).toContain('data: [DONE]');
  });

  it('图片流支持合法 SSE 变体，并且完成后文字请求仍可用', async () => {
    const imageStream = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModelCode,
        stream: true,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '请描述图片' },
          { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
        ] }],
      }),
    });
    expect(imageStream.status).toBe(200);
    const streamBody = await imageStream.text();
    expect(streamBody).toContain('图片已识别');
    expect(streamBody).toContain('data: [DONE]');

    const textResponse = await request('/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: 'hello again' }] }),
    });
    expect(textResponse.status).toBe(200);
  });

  it('上游拒绝图片流时返回明确错误，且不熔断后续文字请求', async () => {
    upstreamMode = 'reject-image';
    const response = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(1200),
      body: JSON.stringify({
        model: visionModelCode,
        stream: true,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] }],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { type: 'upstream_error', message: expect.stringContaining('image payload rejected by upstream') } });

    upstreamMode = 'normal';
    const textResponse = await request('/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: 'text must still work' }] }),
    });
    expect(textResponse.status).toBe(200);
  });

  it('上游流未给 usage 但已给出图片内容时，使用保守估算结算且不影响后续文字调用', async () => {
    upstreamMode = 'stream-without-usage';
    const imageStream = await request('/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: visionModelCode, stream: true,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] }],
      }),
    });
    expect(imageStream.status).toBe(200);
    const streamBody = await imageStream.text();
    expect(streamBody).toContain('图片已识别');
    expect(streamBody).toContain('data: [DONE]');

    upstreamMode = 'normal';
    const textResponse = await request('/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: visionModelCode, messages: [{ role: 'user', content: 'text remains usable' }] }),
    });
    expect(textResponse.status).toBe(200);
  });
});
