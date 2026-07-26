import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const adminRoutes = require('../src/routes/admin.js');

describe('Sub2API 渠道模型计费配置', () => {
  let server;
  let baseUrl;
  let adminToken;
  let channelId;
  let modelCode;

  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const admin = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`billing-admin-${suffix}`, `billing-admin-${suffix}@test.local`, bcrypt.hashSync('safe-pass', 4), 'admin', 'active');
    adminToken = generateToken({ id: admin.lastInsertRowid, username: `billing-admin-${suffix}`, role: 'admin' });
    modelCode = `billing-model-${suffix}`;
    db.prepare("INSERT INTO models (model_code,model_name,status) VALUES (?,?,'active')")
      .run(modelCode, 'Billing model');
    channelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status) VALUES (?,?,?,'active')`)
      .run(`billing-channel-${suffix}`, 'https://billing.example.test/v1', 'upstream-key').lastInsertRowid;

    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  async function request(path, options = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  }

  it('第二轮在渠道列表接口中返回可空渠道倍率字段', async () => {
    const response = await request('/api/admin/channels');
    expect(response.status).toBe(200);

    const payload = await response.json();
    const channel = payload.data.find(item => item.id === channelId);
    expect(channel).toBeTruthy();
    expect(channel).toMatchObject({
      billing_multiplier_input: null,
      billing_multiplier_output: null,
      billing_multiplier_image: null,
    });
  });

  it('管理员可保存渠道倍率，清空后回退到原有全局规则', async () => {
    const payload = {
      channel_name: 'billing-channel-updated',
      base_url: 'https://billing.example.test/v1',
      api_key: '', priority: 0, weight: 100,
      protocol_type: 'openai_compatible', capabilities: ['chat_completions'],
      billing_multiplier_input: 1.25,
      billing_multiplier_output: 1.5,
      billing_multiplier_image: 1.75,
    };
    const update = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', body: JSON.stringify(payload),
    });
    expect(update.status).toBe(200);

    let channel = (await (await request('/api/admin/channels')).json()).data.find(item => item.id === channelId);
    expect(channel).toMatchObject({
      billing_multiplier_input: 1.25,
      billing_multiplier_output: 1.5,
      billing_multiplier_image: 1.75,
    });

    const invalid = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', body: JSON.stringify({ ...payload, billing_multiplier_input: 0 }),
    });
    expect(invalid.status).toBe(400);

    const clear = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT', body: JSON.stringify({
        ...payload,
        billing_multiplier_input: '',
        billing_multiplier_output: null,
        billing_multiplier_image: '',
      }),
    });
    expect(clear.status).toBe(200);
    channel = (await (await request('/api/admin/channels')).json()).data.find(item => item.id === channelId);
    expect(channel).toMatchObject({
      billing_multiplier_input: null,
      billing_multiplier_output: null,
      billing_multiplier_image: null,
    });
  });

  it('保存并返回 token/image/per_request 与计费模型来源配置', async () => {
    const response = await request(`/api/admin/channels/${channelId}/models`, {
      method: 'PUT',
      body: JSON.stringify({
        models: [{
          model_code: modelCode,
          upstream_model_name: 'vendor-image-model',
          supports_image_input: true,
          billing_mode: 'image',
          billing_model_source: 'channel_mapped',
          input_price: 0.000002,
          output_price: 0.000008,
          cache_write_price: 0.0000025,
          cache_read_price: 0.0000005,
          image_input_price: 0.000004,
          image_output_price: 0.00001,
          per_request_price: 0.2,
          image_price_1k: 0.1,
          image_price_2k: 0.15,
          image_price_4k: 0.3,
        }],
      }),
    });
    expect(response.status).toBe(200);

    const payload = await (await request(`/api/admin/channels/${channelId}/models`)).json();
    expect(payload.mappings[0]).toMatchObject({
      model_code: modelCode,
      billing_mode: 'image',
      billing_model_source: 'channel_mapped',
      input_price: 0.000002,
      output_price: 0.000008,
      cache_write_price: 0.0000025,
      cache_read_price: 0.0000005,
      image_input_price: 0.000004,
      image_output_price: 0.00001,
      per_request_price: 0.2,
      image_price_1k: 0.1,
      image_price_2k: 0.15,
      image_price_4k: 0.3,
    });
  });

  it('拒绝未知计费模式和计费模型来源', async () => {
    const invalidMode = await request(`/api/admin/channels/${channelId}/models`, {
      method: 'PUT',
      body: JSON.stringify({ models: [{ model_code: modelCode, billing_mode: 'subscription' }] }),
    });
    expect(invalidMode.status).toBe(400);

    const invalidSource = await request(`/api/admin/channels/${channelId}/models`, {
      method: 'PUT',
      body: JSON.stringify({ models: [{ model_code: modelCode, billing_model_source: 'magic' }] }),
    });
    expect(invalidSource.status).toBe(400);
  });

  it('旧版映射 payload 不会清空已经保存的计费配置', async () => {
    const response = await request(`/api/admin/channels/${channelId}/models`, {
      method: 'PUT',
      body: JSON.stringify({
        model_codes: [modelCode],
        mappings: { [modelCode]: 'legacy-renamed-upstream' },
      }),
    });
    expect(response.status).toBe(200);
    const payload = await (await request(`/api/admin/channels/${channelId}/models`)).json();
    expect(payload.mappings[0]).toMatchObject({
      upstream_model_name: 'legacy-renamed-upstream',
      billing_mode: 'image',
      input_price: 0.000002,
      image_price_4k: 0.3,
    });
  });
});
