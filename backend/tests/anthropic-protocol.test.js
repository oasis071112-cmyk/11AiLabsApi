import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import express from 'express';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const adminRoutes = require('../src/routes/admin.js');
const proxyRoutes = require('../src/routes/proxy.js');
const userRoutes = require('../src/routes/user.js');

describe('原生 Anthropic 协议', () => {
  let apiServer;
  let anthropicServer;
  let openAiTrapServer;
  let apiBaseUrl;
  let anthropicBaseUrl;
  let adminToken;
  let userToken;
  let apiKey;
  let apiKeyId;
  let userId;
  let modelCode;
  let anthropicChannelId;
  let groupName;
  let trapHits = 0;
  const upstreamRequests = [];

  beforeAll(async () => {
    anthropicServer = http.createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        upstreamRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        if (req.method === 'GET' && req.url === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'claude-upstream-test' }] }));
          return;
        }

        if (req.method === 'POST' && req.url === '/v1/messages/count_tokens') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ input_tokens: 37 }));
          return;
        }

        if (req.method !== 'POST' || req.url !== '/v1/messages') {
          res.writeHead(404).end();
          return;
        }

        if (body.stream === true) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          });
          res.end([
            'event: message_start',
            `data: ${JSON.stringify({
              type: 'message_start',
              message: {
                id: 'msg_stream_test',
                type: 'message',
                role: 'assistant',
                model: body.model,
                content: [],
                stop_reason: null,
                usage: {
                  input_tokens: 200,
                  cache_creation_input_tokens: 20,
                  cache_read_input_tokens: 40,
                  output_tokens: 0,
                },
              },
            })}`,
            '',
            'event: content_block_start',
            `data: ${JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            })}`,
            '',
            'event: content_block_delta',
            `data: ${JSON.stringify({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'streamed answer' },
            })}`,
            '',
            'event: message_delta',
            `data: ${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 25 },
            })}`,
            '',
            'event: message_stop',
            `data: ${JSON.stringify({ type: 'message_stop' })}`,
            '',
            '',
          ].join('\n'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_native_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'native answer' }],
          model: body.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 100,
            output_tokens: 500,
          },
        }));
      });
    });
    await new Promise(resolve => anthropicServer.listen(0, '127.0.0.1', resolve));
    anthropicBaseUrl = `http://127.0.0.1:${anthropicServer.address().port}/v1`;

    openAiTrapServer = http.createServer((req, res) => {
      trapHits += 1;
      res.writeHead(418, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'wrong protocol channel selected' } }));
    });
    await new Promise(resolve => openAiTrapServer.listen(0, '127.0.0.1', resolve));
    const openAiTrapBaseUrl = `http://127.0.0.1:${openAiTrapServer.address().port}/v1`;

    await initDatabase();
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;

    const adminId = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`anthropic-admin-${suffix}`, `anthropic-admin-${suffix}@test.local`,
        bcrypt.hashSync('safe-pass', 4), 'admin', 'active').lastInsertRowid;
    adminToken = generateToken({
      id: adminId,
      username: `anthropic-admin-${suffix}`,
      role: 'admin',
    });

    userId = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`anthropic-user-${suffix}`, `anthropic-user-${suffix}@test.local`,
        bcrypt.hashSync('safe-pass', 4), 'user', 'active').lastInsertRowid;
    userToken = generateToken({
      id: userId,
      username: `anthropic-user-${suffix}`,
      role: 'user',
    });
    db.prepare('INSERT INTO wallets (user_id,quota_balance,gift_quota) VALUES (?,?,?)')
      .run(userId, 100, 0);

    modelCode = `claude-native-${suffix}`;
    db.prepare(`INSERT INTO models (
      model_code,model_name,upstream_model_name,model_type,official_provider,official_currency,
      official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,
      billing_multiplier_input,billing_multiplier_output,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      modelCode, 'Claude native test', 'claude-requested-fallback', 'llm', 'anthropic', 'USD',
      1, 2, 0.1, 1_000_000, 1, 1, 'active',
    );

    anthropicChannelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,priority,protocol_type,capabilities)
      VALUES (?,?,?,'active',10,'anthropic',?)`)
      .run(`anthropic-native-${suffix}`, anthropicBaseUrl, 'anthropic-upstream-secret',
        JSON.stringify(['anthropic_messages', 'anthropic_count_tokens'])).lastInsertRowid;
    const trapChannelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,priority,protocol_type,capabilities)
      VALUES (?,?,?,'active',0,'openai_compatible',?)`)
      .run(`openai-trap-${suffix}`, openAiTrapBaseUrl, 'openai-trap-secret',
        JSON.stringify(['chat_completions', 'anthropic_messages', 'anthropic_count_tokens'])).lastInsertRowid;

    groupName = `anthropic-group-${suffix}`;
    const groupId = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')")
      .run(groupName).lastInsertRowid;
    db.prepare(`INSERT INTO routing_group_channels
      (group_id,channel_id,priority,weight,status) VALUES (?,?,10,100,'active')`)
      .run(groupId, anthropicChannelId);
    db.prepare(`INSERT INTO routing_group_channels
      (group_id,channel_id,priority,weight,status) VALUES (?,?,0,100,'active')`)
      .run(groupId, trapChannelId);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,supports_image_input,status) VALUES (?,?,?,1,'active')`)
      .run(anthropicChannelId, modelCode, 'claude-anthropic-mapped');
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
      .run(trapChannelId, modelCode, 'claude-openai-trap');

    apiKey = `sk-ant-${suffix}`;
    apiKeyId = db.prepare(`INSERT INTO api_keys
      (user_id,key_name,key_hash,key_prefix,permission_mode,routing_group_id,status)
      VALUES (?,?,?,?,?,?,'active')`)
      .run(userId, 'Anthropic test key', bcrypt.hashSync(apiKey, 4), apiKey.substring(0, 12),
        'group_dynamic', groupId).lastInsertRowid;

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/admin', adminRoutes);
    app.use('/api/user', userRoutes);
    app.use('/v1', proxyRoutes);
    await new Promise(resolve => { apiServer = app.listen(0, '127.0.0.1', resolve); });
    apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  });

  afterAll(async () => {
    if (apiServer) await new Promise(resolve => apiServer.close(resolve));
    if (anthropicServer) await new Promise(resolve => anthropicServer.close(resolve));
    if (openAiTrapServer) await new Promise(resolve => openAiTrapServer.close(resolve));
  });

  async function request(path, options = {}) {
    return fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  }

  it('管理端可新增 Anthropic 渠道并使用原生鉴权同步模型', async () => {
    const create = await request('/api/admin/channels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel_name: `anthropic-admin-created-${Date.now()}`,
        base_url: anthropicBaseUrl,
        api_key: 'anthropic-admin-upstream-key',
        protocol_type: 'anthropic',
      }),
    });
    expect(create.status).toBe(201);

    const channels = await request('/api/admin/channels', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const created = (await channels.json()).data.find(item =>
      item.channel_name.startsWith('anthropic-admin-created-'));
    expect(created).toMatchObject({
      protocol_type: 'anthropic',
      capabilities: ['anthropic_messages', 'anthropic_count_tokens'],
    });

    const sync = await request(`/api/admin/channels/${created.id}/sync-models`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(sync.status).toBe(200);
    const modelRequest = upstreamRequests.find(item =>
      item.method === 'GET' && item.url === '/v1/models'
        && item.headers['x-api-key'] === 'anthropic-admin-upstream-key');
    expect(modelRequest).toBeTruthy();
    expect(modelRequest.headers.authorization).toBeUndefined();

    const update = await request(`/api/admin/channels/${created.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel_name: created.channel_name,
        base_url: anthropicBaseUrl,
        api_key: '',
        priority: 0,
        weight: 100,
        protocol_type: 'anthropic',
        capabilities: ['anthropic_messages'],
      }),
    });
    expect(update.status).toBe(200);

    const invalid = await request('/api/admin/channels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        channel_name: 'unsupported-protocol',
        base_url: anthropicBaseUrl,
        api_key: 'key',
        protocol_type: 'gemini',
      }),
    });
    expect(invalid.status).toBe(400);
  });

  it('用户只选择分组，文档按管理端渠道配置展示可用原生协议', async () => {
    const channels = await request('/api/user/channels', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const group = (await channels.json()).data.find(item => item.channel_name === groupName);
    expect(group).toMatchObject({
      protocol_type: 'mixed',
      protocol_types: expect.arrayContaining(['openai_compatible', 'anthropic']),
    });

    const docs = await request(`/api/user/docs/channel?channel_name=${encodeURIComponent(groupName)}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(docs.status).toBe(200);
    const payload = await docs.json();
    const anthropicDocs = payload.protocol_docs.find(item => item.protocol_type === 'anthropic');
    expect(anthropicDocs).toMatchObject({
      endpoint: '/v1/messages',
      protocol_label: 'Anthropic Messages',
    });
    expect(anthropicDocs.curl).toContain('x-api-key');
    expect(anthropicDocs.python).toContain(`base_url="${payload.base_url}"`);
    expect(anthropicDocs.nodejs).toContain(`baseURL: "${payload.base_url}"`);
  });

  it('Anthropic 端点的鉴权失败使用原生错误结构', async () => {
    const response = await request('/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-invalid-anthropic-key' },
      body: JSON.stringify({
        model: modelCode,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: 'error',
      error: { type: 'authentication_error', message: 'API Key 无效' },
    });
  });

  it('Messages 使用 x-api-key 原样走 Anthropic 渠道并按真实 usage 扣点', async () => {
    const db = getDatabase();
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;
    const requestBody = {
      model: modelCode,
      max_tokens: 800,
      system: 'Keep the native Anthropic shape.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgo=',
            },
          },
        ],
      }],
      tools: [{
        name: 'get_weather',
        description: 'Get weather',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
      tool_choice: { type: 'auto' },
      temperature: 0.2,
    };
    const response = await request('/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'test-beta',
      },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      id: 'msg_native_test',
      type: 'message',
      model: 'claude-anthropic-mapped',
      content: [{ type: 'text', text: 'native answer' }],
    });
    const upstream = upstreamRequests.find(item =>
      item.url === '/v1/messages' && item.body?.stream !== true);
    expect(upstream.headers).toMatchObject({
      'x-api-key': 'anthropic-upstream-secret',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'test-beta',
    });
    expect(upstream.headers.authorization).toBeUndefined();
    const { model: requestedModel, max_tokens: requestedMaxTokens, ...nativeFields } = requestBody;
    expect(upstream.body).toMatchObject({
      ...nativeFields,
      model: 'claude-anthropic-mapped',
    });
    expect(upstream.body.max_tokens).toBeGreaterThan(0);
    expect(upstream.body.max_tokens).toBeLessThanOrEqual(requestedMaxTokens);
    expect(trapHits).toBe(0);

    const log = db.prepare(`SELECT * FROM api_request_logs
      WHERE api_key_id=? AND status='success' ORDER BY id DESC`).get(apiKeyId);
    expect(log).toMatchObject({
      model_code: modelCode,
      upstream_channel_id: anthropicChannelId,
      request_protocol: 'anthropic',
      upstream_protocol: 'anthropic',
      input_tokens: 1000,
      cached_input_tokens: 100,
      cache_creation_tokens: 50,
      output_tokens: 500,
    });
    const after = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;
    expect(log.total_cost).toBeGreaterThan(0);
    expect(after).toBeCloseTo(before - log.total_cost, 8);
  });

  it('Count Tokens 走独立原生路径且不改变点数余额', async () => {
    const db = getDatabase();
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;
    const response = await request('/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelCode,
        system: 'Count this.',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ input_tokens: 37 });
    const upstream = upstreamRequests.find(item => item.url === '/v1/messages/count_tokens');
    expect(upstream.body.model).toBe('claude-anthropic-mapped');
    expect(upstream.headers['x-api-key']).toBe('anthropic-upstream-secret');
    expect(trapHits).toBe(0);
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance)
      .toBeCloseTo(before, 8);
    expect(db.prepare(`SELECT input_tokens,total_cost,billing_mode,request_protocol,upstream_protocol,status
      FROM api_request_logs WHERE api_key_id=? ORDER BY id DESC`).get(apiKeyId)).toMatchObject({
      input_tokens: 37,
      total_cost: 0,
      billing_mode: 'count_tokens',
      request_protocol: 'anthropic',
      upstream_protocol: 'anthropic',
      status: 'success',
    });
  });

  it('模型列表暴露 Anthropic 原生接口能力但不要求用户选择协议', async () => {
    const response = await request('/v1/models', {
      headers: { 'x-api-key': apiKey },
    });
    expect(response.status).toBe(200);
    const model = (await response.json()).data.find(item => item.id === modelCode);
    expect(model.capabilities).toMatchObject({
      chat_completions: true,
      anthropic_messages: true,
      anthropic_count_tokens: true,
      image_input: true,
    });
  });

  it('流式 Messages 保留原生 SSE 事件并在 message_stop 前完成结算', async () => {
    const db = getDatabase();
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;
    const response = await request('/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelCode,
        max_tokens: 100,
        stream: true,
        messages: [{ role: 'user', content: 'Stream natively.' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = await response.text();
    expect(stream).toContain('event: message_start');
    expect(stream).toContain('event: content_block_delta');
    expect(stream).toContain('"text":"streamed answer"');
    expect(stream).toContain('event: message_stop');
    expect(stream).not.toContain('[DONE]');
    expect(trapHits).toBe(0);

    const log = db.prepare(`SELECT * FROM api_request_logs
      WHERE api_key_id=? AND status='success' ORDER BY id DESC`).get(apiKeyId);
    expect(log).toMatchObject({
      request_protocol: 'anthropic',
      upstream_protocol: 'anthropic',
      input_tokens: 200,
      cached_input_tokens: 40,
      cache_creation_tokens: 20,
      output_tokens: 25,
    });
    const after = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;
    expect(after).toBeCloseTo(before - log.total_cost, 8);
  });
});
