import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const userRoutes = require('../src/routes/user.js');
const proxyRoutes = require('../src/routes/proxy.js');
const { createCodexCompatibilityRouter } = require('../src/routes/codex-compat.js');

const TEST_IMAGE_BYTES = {
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
  'image/webp': Buffer.from('524946460400000057454250', 'hex'),
};

function testImageBlob(type) {
  return new Blob([TEST_IMAGE_BYTES[type]], { type });
}

describe('图片生成端点计费', () => {
  let apiServer;
  let upstreamServer;
  let fallbackUpstreamServer;
  let apiBaseUrl;
  let fallbackUpstreamBaseUrl;
  let apiKey;
  let apiKeyId;
  let userId;
  let userToken;
  let modelCode;
  let secondaryImageModelCode;
  let channelId;
  let groupId;
  let upstreamMode = 'images';
  let upstreamImageSize = null;
  let lastUpstreamRequest = null;
  let fallbackUpstreamRequest = null;

  beforeAll(async () => {
    upstreamServer = http.createServer((req, res) => {
      if (req.method !== 'POST' || ![
        '/v1/images/generations',
        '/v1/images/edits',
        '/v1/images/variations',
        '/v1/responses',
      ].includes(req.url)) {
        res.writeHead(404).end();
        return;
      }
      const chunks = [];
      req.on('data', chunk => { chunks.push(Buffer.from(chunk)); });
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const contentType = String(req.headers['content-type'] || '');
        const body = contentType.includes('application/json') ? JSON.parse(raw.toString('utf8') || '{}') : {};
        lastUpstreamRequest = { url: req.url, contentType, body, raw: raw.toString('utf8') };
        if (upstreamMode === 'reject') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'image rejected by upstream' } }));
          return;
        }
        if (upstreamMode === 'failover') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'primary credentials rejected' } }));
          return;
        }
        if (upstreamMode === 'disconnect') {
          req.socket.destroy();
          return;
        }
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
            usage: body.__test_usage,
            data: [
              { b64_json: 'image-a', ...(upstreamImageSize ? { size: upstreamImageSize } : {}) },
              { url: 'https://example.test/image-b.png', ...(upstreamImageSize ? { size: upstreamImageSize } : {}) },
            ],
            }));
      });
    });
    await new Promise(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
    const upstreamBaseUrl = `http://127.0.0.1:${upstreamServer.address().port}/v1`;
    fallbackUpstreamServer = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/images/edits') {
        res.writeHead(404).end();
        return;
      }
      const chunks = [];
      req.on('data', chunk => { chunks.push(Buffer.from(chunk)); });
      req.on('end', () => {
        fallbackUpstreamRequest = {
          contentType: String(req.headers['content-type'] || ''),
          raw: Buffer.concat(chunks).toString('utf8'),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: 1,
          model: 'fallback-upstream-image-model',
          data: [{ b64_json: 'fallback-image' }],
        }));
      });
    });
    await new Promise(resolve => fallbackUpstreamServer.listen(0, '127.0.0.1', resolve));
    fallbackUpstreamBaseUrl = `http://127.0.0.1:${fallbackUpstreamServer.address().port}/v1`;

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
    channelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,protocol_type,capabilities) VALUES (?,?,?,'active','openai_compatible',?)`)
      .run(
        `image-channel-${suffix}`,
        upstreamBaseUrl,
        'upstream-image-key',
        JSON.stringify(['image_generations', 'image_edits', 'image_variations', 'image_transformations', 'responses']),
      ).lastInsertRowid;
    groupId = db.prepare('INSERT INTO routing_groups (group_name,status) VALUES (?,?)')
      .run(`image-group-${suffix}`, 'active').lastInsertRowid;
    db.prepare("INSERT INTO routing_group_channels (group_id,channel_id,status) VALUES (?,?,'active')").run(groupId, channelId);
    db.prepare("INSERT INTO channel_models (channel_id,model_code,upstream_model_name,supports_image_input,status) VALUES (?,?,?,1,'active')")
      .run(channelId, modelCode, 'upstream-image-model');
    secondaryImageModelCode = `secondary-image-model-${suffix}`;
    db.prepare(`INSERT INTO models (
      model_code,model_name,upstream_model_name,model_type,official_provider,official_currency,
      official_image_prices,billing_multiplier_image,status
    ) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      secondaryImageModelCode, 'Secondary image model', 'secondary-upstream-image', 'image',
      'openai', 'USD', '{}', 1, 'active',
    );
    db.prepare(`INSERT INTO channel_models (
      channel_id,model_code,upstream_model_name,billing_mode,billing_model_source,image_price_1k,status
    ) VALUES (?,?,?,'image','requested',?,'active')`)
      .run(channelId, secondaryImageModelCode, 'secondary-upstream-image', 0.5);
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
    app.use(createCodexCompatibilityRouter({ proxyRouter: proxyRoutes }));
    await new Promise(resolve => { apiServer = app.listen(0, '127.0.0.1', resolve); });
    apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  });

  afterAll(async () => {
    if (apiServer) await new Promise(resolve => apiServer.close(resolve));
    if (upstreamServer) await new Promise(resolve => upstreamServer.close(resolve));
    if (fallbackUpstreamServer) await new Promise(resolve => fallbackUpstreamServer.close(resolve));
  });

  async function request(path, options = {}) {
    return fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  }

  async function multipartRequest(path, form) {
    return fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  }

  it('Codex 根路径保留 Bearer 鉴权且 actor header 不能单独授权', async () => {
    const unauthorized = await request('/images/generations', {
      method: 'POST',
      headers: { 'x-openai-actor-authorization': 'local-image-extension' },
      body: JSON.stringify({ model: modelCode, prompt: 'draw', size: '1024x1024', n: 1 }),
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await request('/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-openai-actor-authorization': 'local-image-extension',
      },
      body: JSON.stringify({ model: modelCode, prompt: 'draw', size: '1024x1024', n: 1 }),
    });
    expect(authorized.status).toBe(200);
    getDatabase().prepare('UPDATE wallets SET quota_balance=100,frozen_balance=0 WHERE user_id=?').run(userId);
  });

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
      billing_model: modelCode,
      billing_model_source: 'requested',
      image_count: 2,
      image_size: '1K',
      official_image_unit_price: 0.031,
      billing_multiplier_image: 1.2,
    });
    expect(log.total_cost).toBeCloseTo(0.5208, 8);
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance)
      .toBeCloseTo(99.4792, 8);

    const logsResponse = await request('/api/user/logs?limit=5', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const userLog = (await logsResponse.json()).data.find(item => item.request_id === log.request_id);
    expect(userLog.billing_detail).toMatchObject({ mode: 'image_snapshot', reconciled: true });
    expect(userLog).toMatchObject({ default_image_unit_price: 0.0465, default_image_currency: 'USD' });
    expect(userLog).not.toHaveProperty('billing_model');
    expect(userLog).not.toHaveProperty('official_image_unit_price');
    expect(userLog.billing_detail.dimensions[0]).not.toHaveProperty('billingModel');
    expect(userLog.billing_detail.dimensions[0]).not.toHaveProperty('unitPrice');
  });

  it('路由分组图片倍率优先于全局倍率并写入本次账单快照', async () => {
    const db = getDatabase();
    db.prepare('UPDATE routing_groups SET billing_multiplier_image=? WHERE id=?').run(1.8, groupId);
    try {
      const response = await request('/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelCode, prompt: 'channel multiplier', size: '1024x1024', n: 1 }),
      });

      expect(response.status).toBe(200);
      const log = db.prepare("SELECT billing_multiplier_image,billing_multiplier_source_image,upstream_channel_name,total_cost FROM api_request_logs WHERE api_key_id=? AND billing_mode='image' AND status='success' ORDER BY id DESC").get(apiKeyId);
      expect(log).toMatchObject({
        billing_multiplier_image: 1.8,
        billing_multiplier_source_image: 'routing_group',
        upstream_channel_name: expect.stringContaining('image-channel-'),
      });
      expect(log.total_cost).toBeCloseTo(0.7812, 8);
    } finally {
      db.prepare('UPDATE routing_groups SET billing_multiplier_image=NULL WHERE id=?').run(groupId);
    }
  });

  it('用户专属图片倍率优先于路由分组倍率并写入来源快照', async () => {
    const db = getDatabase();
    db.prepare('UPDATE routing_groups SET billing_multiplier_image=? WHERE id=?').run(1.8, groupId);
    const ruleId = db.prepare(`INSERT INTO pricing_rules
      (rule_name,model_code,scope_type,scope_id,billing_multiplier_input,billing_multiplier_output,
       billing_multiplier_image,priority,status)
      VALUES (?,?, 'user',?,1,1,0.7,10,'active')`)
      .run(`image-user-rate-${Date.now()}`, modelCode, userId).lastInsertRowid;
    try {
      const response = await request('/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelCode, prompt: 'user multiplier', size: '1024x1024', n: 1 }),
      });

      expect(response.status).toBe(200);
      const log = db.prepare(`SELECT billing_multiplier_image,billing_multiplier_source_image
        FROM api_request_logs WHERE api_key_id=? AND billing_mode='image'
        AND status='success' ORDER BY id DESC`).get(apiKeyId);
      expect(log).toMatchObject({
        billing_multiplier_image: 0.7,
        billing_multiplier_source_image: 'user',
      });
    } finally {
      db.prepare('DELETE FROM pricing_rules WHERE id=?').run(ruleId);
      db.prepare('UPDATE routing_groups SET billing_multiplier_image=NULL WHERE id=?').run(groupId);
    }
  });

  it('Responses 原生图片工具按实际 image_generation_call 结果计费', async () => {
    const db = getDatabase();
    db.prepare('UPDATE routing_groups SET billing_multiplier_image=? WHERE id=?').run(1.8, groupId);
    try {
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
      const log = db.prepare("SELECT * FROM api_request_logs WHERE api_key_id=? AND billing_mode='image' AND status='success' ORDER BY id DESC").get(apiKeyId);
      expect(log).toMatchObject({
        model_code: modelCode,
        billing_model: modelCode,
        billing_model_source: 'requested',
        image_count: 1,
        image_size: '1K',
        billing_multiplier_image: 1.8,
      });
      expect(log.total_cost).toBeCloseTo(0.3906, 8);
    } finally {
      db.prepare('UPDATE routing_groups SET billing_multiplier_image=NULL WHERE id=?').run(groupId);
    }
  });

  it('Responses 图片编辑输入在请求上游前校验模型图片输入能力', async () => {
    const db = getDatabase();
    db.prepare('UPDATE channel_models SET supports_image_input=0 WHERE channel_id=? AND model_code=?')
      .run(channelId, modelCode);
    try {
      const response = await request('/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelCode,
          input: [{ role: 'user', content: [
            { type: 'input_text', text: 'edit this image' },
            { type: 'input_image', image_url: 'data:image/png;base64,c291cmNlLWltYWdl' },
          ] }],
          tools: [{ type: 'image_generation', model: modelCode, action: 'edit' }],
          tool_choice: { type: 'image_generation' },
        }),
      });
      expect(response.status).toBe(503);
      expect((await response.json()).error.type).toBe('no_channel');
    } finally {
      db.prepare('UPDATE channel_models SET supports_image_input=1 WHERE channel_id=? AND model_code=?')
        .run(channelId, modelCode);
    }
  });

  it('Responses 主模型与图片工具模型不同时使用图片模型映射的计费配置', async () => {
    const response = await request('/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelCode,
        input: 'draw with a separate image model',
        tools: [{ type: 'image_generation', model: secondaryImageModelCode, size: '1024x1024' }],
      }),
    });

    expect(response.status).toBe(200);
    const log = getDatabase().prepare("SELECT * FROM api_request_logs WHERE api_key_id=? AND status='success' ORDER BY id DESC").get(apiKeyId);
    expect(log).toMatchObject({
      billing_mode: 'image',
      billing_model: secondaryImageModelCode,
      official_image_unit_price: 0.5,
      image_size: '1K',
    });
    expect(log.total_cost).toBeCloseTo(3.5, 8);
  });

  it('未配置图片价时使用 Sub2API 默认价，并以上游实际尺寸的最高档结算', async () => {
    const db = getDatabase();
    db.prepare("UPDATE models SET official_image_prices='{}' WHERE model_code=?").run(modelCode);
    upstreamImageSize = '3840x2160';
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;

    const response = await request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelCode, prompt: 'draw 4k', size: '1024x1024', n: 2 }),
    });

    expect(response.status).toBe(200);
    const log = db.prepare("SELECT * FROM api_request_logs WHERE api_key_id=? AND status='success' ORDER BY id DESC").get(apiKeyId);
    expect(log).toMatchObject({
      billing_mode: 'image',
      image_count: 2,
      image_size: '4K',
      image_input_size: '1K',
      image_output_size: '4K',
      image_size_source: 'output',
      official_image_unit_price: 0.062,
    });
    expect(JSON.parse(log.image_size_breakdown)).toEqual(['4K', '4K']);
    expect(log.total_cost).toBeCloseTo(1.0416, 8);
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance)
      .toBeCloseTo(before - 1.0416, 8);

    upstreamImageSize = null;
    db.prepare('UPDATE models SET official_image_prices=? WHERE model_code=?')
      .run(JSON.stringify({ default: 0.04, '1024x1024': 0.04 }), modelCode);
  });

  it('图片渠道即使配置 Token 单价仍按图片张数结算且只扣一次', async () => {
    const db = getDatabase();
    db.prepare(`UPDATE channel_models SET
      billing_mode='token',billing_model_source='requested',
      input_price=?,output_price=?,cache_read_price=?,cache_write_price=?
      WHERE channel_id=? AND model_code=?`)
      .run(0.000003, 0.000008, 0.0000002, 0.000004, channelId, modelCode);
    const before = db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance;

    const response = await request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelCode,
        prompt: 'token billed image',
        __test_usage: {
          input_tokens: 1000,
          output_tokens: 500,
          input_tokens_details: { cached_tokens: 200, cache_creation_tokens: 100 },
        },
      }),
    });

    expect(response.status).toBe(200);
    const logs = db.prepare("SELECT * FROM api_request_logs WHERE api_key_id=? AND status='success' ORDER BY id DESC LIMIT 2").all(apiKeyId);
    expect(logs[0]).toMatchObject({
      billing_mode: 'image',
      billing_model: modelCode,
      billing_model_source: 'requested',
      input_tokens: 1000,
      cached_input_tokens: 200,
      cache_creation_tokens: 100,
      output_tokens: 500,
    });
    const expectedImageCost = 2 * logs[0].official_image_unit_price * 7 * logs[0].billing_multiplier_image;
    expect(logs[0].total_cost).toBeCloseTo(expectedImageCost, 8);
    expect(db.prepare('SELECT COUNT(*) count FROM api_request_logs WHERE request_id=?').get(logs[0].request_id).count).toBe(1);
    expect(db.prepare('SELECT quota_balance FROM wallets WHERE user_id=?').get(userId).quota_balance)
      .toBeCloseTo(before - expectedImageCost, 8);

    db.prepare(`UPDATE channel_models SET
      billing_mode='',billing_model_source='channel_mapped',
      input_price=NULL,output_price=NULL,cache_read_price=NULL,cache_write_price=NULL
      WHERE channel_id=? AND model_code=?`).run(channelId, modelCode);
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
    upstreamMode = 'images';
    db.prepare('UPDATE upstream_channels SET health_score=100,consecutive_failures=0,circuit_breaker_until=NULL WHERE id=?').run(channelId);
  });

  it('multipart 图片编辑透传图片与蒙版，并沿用单张图片价格结算', async () => {
    const form = new FormData();
    form.set('model', modelCode);
    form.set('prompt', 'replace the sky');
    form.append('image', testImageBlob('image/png'), 'source.png');
    form.append('mask', testImageBlob('image/png'), 'mask.png');
    const response = await multipartRequest('/v1/images/edits', form);

    expect(response.status).toBe(200);
    expect(lastUpstreamRequest).toMatchObject({ url: '/v1/images/edits' });
    expect(lastUpstreamRequest.contentType).toContain('multipart/form-data');
    expect(lastUpstreamRequest.raw).toContain('name="image"; filename="source.png"');
    expect(lastUpstreamRequest.raw).toContain('name="mask"; filename="mask.png"');
    const log = getDatabase().prepare(`SELECT image_operation,image_input_count,image_output_format,image_output_compression,
      image_count,billing_mode FROM api_request_logs WHERE api_key_id=? AND status='success' ORDER BY id DESC`).get(apiKeyId);
    expect(log).toMatchObject({
      image_operation: 'edit', image_input_count: 1, image_count: 2, billing_mode: 'image',
    });
  });

  it('Codex JSON 图片编辑透传图片引用并按实际输出结算', async () => {
    const source = `data:image/png;base64,${TEST_IMAGE_BYTES['image/png'].toString('base64')}`;
    const response = await request('/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelCode,
        prompt: 'replace the sky',
        images: [{ image_url: source }, { image_url: 'https://example.test/reference.webp' }],
        output_format: 'webp',
      }),
    });

    expect(response.status).toBe(200);
    expect(lastUpstreamRequest).toMatchObject({
      url: '/v1/images/edits',
      contentType: expect.stringContaining('application/json'),
      body: {
        model: 'upstream-image-model',
        prompt: 'replace the sky',
        images: [{ image_url: source }, { image_url: 'https://example.test/reference.webp' }],
        n: 1,
        output_format: 'webp',
      },
    });
    const log = getDatabase().prepare(`SELECT image_operation,image_input_count,image_output_format,
      image_count,billing_mode FROM api_request_logs WHERE api_key_id=? AND status='success' ORDER BY id DESC`).get(apiKeyId);
    expect(log).toMatchObject({
      image_operation: 'edit', image_input_count: 2, image_output_format: 'webp',
      image_count: 2, billing_mode: 'image',
    });
  });

  it('multipart 图片变体要求图片输入并转发到标准 variations 端点', async () => {
    const form = new FormData();
    form.set('model', modelCode);
    form.set('n', '1');
    form.append('image', testImageBlob('image/webp'), 'source.webp');
    const response = await multipartRequest('/v1/images/variations', form);

    expect(response.status).toBe(200);
    expect(lastUpstreamRequest).toMatchObject({ url: '/v1/images/variations' });
    expect(lastUpstreamRequest.raw).toContain('name="image"; filename="source.webp"');
    const log = getDatabase().prepare('SELECT image_operation,image_input_count FROM api_request_logs WHERE api_key_id=? AND status=\'success\' ORDER BY id DESC').get(apiKeyId);
    expect(log).toMatchObject({ image_operation: 'variation', image_input_count: 1 });
  });

  it('扩展变换映射为非流式 Responses 图片编辑工具，并转发格式与压缩参数', async () => {
    const form = new FormData();
    form.set('model', modelCode);
    form.set('prompt', 'preserve content and optimize file size');
    form.set('output_format', 'webp');
    form.set('output_compression', '60');
    form.set('input_fidelity', 'high');
    form.append('image', testImageBlob('image/jpeg'), 'source.jpg');
    const response = await multipartRequest('/v1/images/transformations', form);

    expect(response.status).toBe(200);
    expect(lastUpstreamRequest).toMatchObject({ url: '/v1/responses' });
    expect(lastUpstreamRequest.body).toMatchObject({
      stream: false,
      tool_choice: { type: 'image_generation' },
      tools: [{ type: 'image_generation', action: 'edit', output_format: 'webp', output_compression: 60, input_fidelity: 'high' }],
    });
    expect(lastUpstreamRequest.body.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_image', image_url: expect.stringContaining('data:image/jpeg;base64,') }),
    ]));
    const log = getDatabase().prepare(`SELECT image_operation,image_input_count,image_output_format,image_output_compression
      FROM api_request_logs WHERE api_key_id=? AND status='success' ORDER BY id DESC`).get(apiKeyId);
    expect(log).toMatchObject({
      image_operation: 'transformation', image_input_count: 1, image_output_format: 'webp', image_output_compression: 60,
    });
    expect(JSON.stringify(log)).not.toContain('source-image');
  });

  it('图片编辑在安全故障切换后重建 multipart 并由备用渠道成功处理', async () => {
    const db = getDatabase();
    const fallbackChannelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,protocol_type,capabilities) VALUES (?,?,?,'active','openai_compatible',?)`)
      .run(`image-fallback-${Date.now()}`, fallbackUpstreamBaseUrl, 'fallback-image-key',
        JSON.stringify(['image_edits']))
      .lastInsertRowid;
    db.prepare("INSERT INTO routing_group_channels (group_id,channel_id,priority,status) VALUES (?,?,10,'active')")
      .run(groupId, fallbackChannelId);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,supports_image_input,status) VALUES (?,?,?,1,'active')`)
      .run(fallbackChannelId, modelCode, 'fallback-upstream-image-model');
    db.prepare('UPDATE routing_group_channels SET priority=1 WHERE group_id=? AND channel_id=?')
      .run(groupId, channelId);
    upstreamMode = 'failover';
    fallbackUpstreamRequest = null;
    try {
      const form = new FormData();
      form.set('model', modelCode);
      form.set('prompt', 'retry through fallback');
      form.append('image', testImageBlob('image/png'), 'source.png');
      const response = await multipartRequest('/v1/images/edits', form);

      expect(response.status).toBe(200);
      expect(lastUpstreamRequest).toMatchObject({ url: '/v1/images/edits' });
      expect(fallbackUpstreamRequest).toMatchObject({ contentType: expect.stringContaining('multipart/form-data') });
      expect(fallbackUpstreamRequest.raw).toContain('name="image"; filename="source.png"');
      expect(fallbackUpstreamRequest.contentType).not.toBe(lastUpstreamRequest.contentType);
    } finally {
      upstreamMode = 'images';
      db.prepare("UPDATE upstream_channels SET status='inactive' WHERE id=?").run(fallbackChannelId);
      db.prepare('UPDATE upstream_channels SET health_score=100,consecutive_failures=0,circuit_breaker_until=NULL WHERE id=?').run(channelId);
    }
  });

  it('图片编辑收到上游明确 4xx 时释放冻结额度并保留审计快照', async () => {
    const db = getDatabase();
    const before = db.prepare('SELECT quota_balance,frozen_balance FROM wallets WHERE user_id=?').get(userId);
    upstreamMode = 'reject';
    try {
      const form = new FormData();
      form.set('model', modelCode);
      form.set('prompt', 'the upstream will reject this');
      form.set('output_format', 'webp');
      form.append('image', testImageBlob('image/png'), 'source.png');
      const response = await multipartRequest('/v1/images/edits', form);

      expect(response.status).toBe(400);
      expect((await response.json()).error.type).toBe('upstream_error');
      expect(db.prepare('SELECT quota_balance,frozen_balance FROM wallets WHERE user_id=?').get(userId)).toMatchObject(before);
      expect(db.prepare(`SELECT error_type,image_operation,image_input_count,image_output_format
        FROM api_request_logs WHERE api_key_id=? ORDER BY id DESC`).get(apiKeyId)).toMatchObject({
        error_type: 'upstream_error', image_operation: 'edit', image_input_count: 1, image_output_format: 'webp',
      });
    } finally {
      upstreamMode = 'images';
      db.prepare('UPDATE upstream_channels SET health_score=100,consecutive_failures=0,circuit_breaker_until=NULL WHERE id=?').run(channelId);
    }
  });

  it('图片编辑在上游连接中断时保留冻结额度并写入待核对图片快照', async () => {
    const db = getDatabase();
    const beforeFrozen = db.prepare('SELECT frozen_balance FROM wallets WHERE user_id=?').get(userId).frozen_balance;
    upstreamMode = 'disconnect';
    try {
      const form = new FormData();
      form.set('model', modelCode);
      form.set('prompt', 'connection will close');
      form.set('output_format', 'webp');
      form.set('output_compression', '60');
      form.append('image', testImageBlob('image/png'), 'source.png');
      const response = await multipartRequest('/v1/images/edits', form);

      expect(response.status).toBe(504);
      expect((await response.json()).error.type).toBe('settlement_pending');
      expect(db.prepare('SELECT frozen_balance FROM wallets WHERE user_id=?').get(userId).frozen_balance).toBeGreaterThan(beforeFrozen);
      expect(db.prepare(`SELECT error_type,image_operation,image_input_count,image_output_format,image_output_compression
        FROM api_request_logs WHERE api_key_id=? ORDER BY id DESC`).get(apiKeyId)).toMatchObject({
        error_type: 'settlement_failed', image_operation: 'edit', image_input_count: 1,
        image_output_format: 'webp', image_output_compression: 60,
      });
    } finally {
      upstreamMode = 'images';
      db.prepare('UPDATE wallets SET frozen_balance=? WHERE user_id=?').run(beforeFrozen, userId);
      db.prepare('UPDATE upstream_channels SET health_score=100,consecutive_failures=0,circuit_breaker_until=NULL WHERE id=?').run(channelId);
    }
  });
});
