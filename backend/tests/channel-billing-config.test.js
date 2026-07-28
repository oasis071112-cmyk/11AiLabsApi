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
  let groupId;
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
    groupId = db.prepare(`INSERT INTO routing_groups
      (group_name,status) VALUES (?,'active')`)
      .run(`billing-group-${suffix}`).lastInsertRowid;
    db.prepare(`INSERT INTO routing_group_channels
      (group_id,channel_id,status) VALUES (?,?,'active')`).run(groupId, channelId);

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

  it('路由分组列表返回可空倍率字段', async () => {
    const response = await request('/api/admin/routing-groups');
    expect(response.status).toBe(200);

    const payload = await response.json();
    const group = payload.data.find(item => item.id === groupId);
    expect(group).toBeTruthy();
    expect(group).toMatchObject({
      billing_multiplier_input: null,
      billing_multiplier_output: null,
      billing_multiplier_image: null,
    });
  });

  it('管理员可保存路由分组倍率，清空后回退全局倍率', async () => {
    const payload = {
      group_name: `billing-group-updated-${Date.now()}`,
      description: '倍率由路由分组管理',
      status: 'active',
      channels: [{ channel_id: channelId, priority: 0, weight: 100, status: 'active' }],
      billing_multiplier_input: 1.25,
      billing_multiplier_output: 1.5,
      billing_multiplier_image: 1.75,
    };
    const update = await request(`/api/admin/routing-groups/${groupId}`, {
      method: 'PUT', body: JSON.stringify(payload),
    });
    expect(update.status).toBe(200);

    let group = (await (await request('/api/admin/routing-groups')).json()).data.find(item => item.id === groupId);
    expect(group).toMatchObject({
      billing_multiplier_input: 1.25,
      billing_multiplier_output: 1.5,
      billing_multiplier_image: 1.75,
    });

    const invalid = await request(`/api/admin/routing-groups/${groupId}`, {
      method: 'PUT', body: JSON.stringify({ ...payload, billing_multiplier_input: 0 }),
    });
    expect(invalid.status).toBe(400);

    const clear = await request(`/api/admin/routing-groups/${groupId}`, {
      method: 'PUT', body: JSON.stringify({
        ...payload,
        billing_multiplier_input: '',
        billing_multiplier_output: null,
        billing_multiplier_image: '',
      }),
    });
    expect(clear.status).toBe(200);
    group = (await (await request('/api/admin/routing-groups')).json()).data.find(item => item.id === groupId);
    expect(group).toMatchObject({
      billing_multiplier_input: null,
      billing_multiplier_output: null,
      billing_multiplier_image: null,
    });
  });

  it('渠道接口不再暴露或保存用户扣费倍率', async () => {
    const update = await request(`/api/admin/channels/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify({
        channel_name: 'billing-channel-with-ignored-rate',
        base_url: 'https://billing.example.test/v1',
        api_key: '',
        priority: 0,
        weight: 100,
        protocol_type: 'openai_compatible',
        capabilities: ['chat_completions'],
        billing_multiplier_input: 9,
        billing_multiplier_output: 9,
        billing_multiplier_image: 9,
      }),
    });
    expect(update.status).toBe(200);
    const channel = (await (await request('/api/admin/channels')).json()).data
      .find(item => item.id === channelId);
    expect(channel).not.toHaveProperty('billing_multiplier_input');
    expect(channel).not.toHaveProperty('billing_multiplier_output');
    expect(channel).not.toHaveProperty('billing_multiplier_image');
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

  it('批量保存只修改明确提交的映射，不下架未提交的已有映射', async () => {
    const db = getDatabase();
    const untouchedModel = `untouched-${Date.now()}-${Math.random()}`;
    db.prepare("INSERT INTO models (model_code,model_name,status) VALUES (?,?,'active')")
      .run(untouchedModel, untouchedModel);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
      .run(channelId, untouchedModel, untouchedModel);

    const response = await request(`/api/admin/channels/${channelId}/models`, {
      method: 'PUT',
      body: JSON.stringify({
        models: [{
          model_code: modelCode,
          upstream_model_name: 'only-this-model-is-updated',
          status: 'active',
        }],
      }),
    });
    expect(response.status).toBe(200);
    expect(db.prepare(`SELECT status FROM channel_models
      WHERE channel_id=? AND model_code=?`).get(channelId, untouchedModel).status).toBe('active');
  });
});
