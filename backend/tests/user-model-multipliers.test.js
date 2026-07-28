import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const userRoutes = require('../src/routes/user.js');

describe('用户可用模型倍率', () => {
  let server;
  let baseUrl;
  let userId;
  let userToken;
  let modelCode;
  let channelId;
  let groupId;

  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const user = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`model-rate-user-${suffix}`, `model-rate-user-${suffix}@test.local`,
        bcrypt.hashSync('safe-pass', 4), 'user', 'active');
    userId = user.lastInsertRowid;
    userToken = generateToken({ id: userId, username: `model-rate-user-${suffix}`, role: 'user' });
    modelCode = `image-rate-${suffix}`;
    db.prepare(`INSERT INTO models
      (model_code,model_name,model_type,billing_multiplier_input,billing_multiplier_output,
       billing_multiplier_image,status)
      VALUES (?,?,'image',1,1,1,'active')`).run(modelCode, 'Image rate model');
    channelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,protocol_type,capabilities)
      VALUES (?,?,?,'active','openai_compatible','["image_generations"]')`)
      .run(`image-rate-channel-${suffix}`, 'https://image-rate.test/v1', 'upstream-key').lastInsertRowid;
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
      .run(channelId, modelCode, modelCode);
    groupId = db.prepare(`INSERT INTO routing_groups
      (group_name,status,billing_multiplier_image) VALUES (?,'active',0.35)`)
      .run(`image-rate-group-${suffix}`).lastInsertRowid;
    db.prepare(`INSERT INTO routing_group_channels
      (group_id,channel_id,status) VALUES (?,?,'active')`).run(groupId, channelId);
    db.prepare(`INSERT INTO api_keys
      (user_id,key_name,key_hash,key_prefix,routing_group_id,permission_mode,status)
      VALUES (?,?,?,?,?,'group_dynamic','active')`)
      .run(userId, 'image-rate-key', `image-rate-hash-${suffix}`, 'sk-image-rate', groupId);
    db.prepare(`INSERT INTO pricing_rules
      (rule_name,model_code,scope_type,billing_multiplier_input,billing_multiplier_output,
       billing_multiplier_image,priority,status)
      VALUES (?,?,'platform',0.3,0.3,0.3,100,'active')`)
      .run(`platform-image-rate-${suffix}`, modelCode);

    const app = express();
    app.use(express.json());
    app.use('/api/user', userRoutes);
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  async function listModels() {
    const response = await fetch(`${baseUrl}/api/user/models`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(response.status).toBe(200);
    return response.json();
  }

  it('按已创建 Key 的路由分组返回模型、协议、类型和分组倍率', async () => {
    const payload = await listModels();
    const group = payload.groups.find(item => item.id === groupId);
    expect(group).toMatchObject({
      billing_multiplier_input: null,
      billing_multiplier_output: null,
      billing_multiplier_image: 0.35,
    });
    expect(group.models.find(item => item.model_code === modelCode)).toMatchObject({
      model_type: 'image',
      protocol_types: ['openai_compatible'],
    });
    expect(payload.data.find(item => item.model_code === modelCode)).toEqual(expect.objectContaining({
      model_type: 'image',
      protocol_types: ['openai_compatible'],
    }));
    expect(payload.data.find(item => item.model_code === modelCode))
      .not.toHaveProperty('billing_multiplier_image');
  });

  it('未创建任何路由分组 Key 时模型与分组均为空', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const user = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`no-key-user-${suffix}`, `no-key-user-${suffix}@test.local`,
        bcrypt.hashSync('safe-pass', 4), 'user', 'active');
    const token = generateToken({
      id: user.lastInsertRowid, username: `no-key-user-${suffix}`, role: 'user',
    });
    const response = await fetch(`${baseUrl}/api/user/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [],
      groups: [],
      has_api_keys: false,
    });
  });

  it('旧式限权 Key 仅展示该 Key 实际获准使用的分组模型', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const hiddenModelCode = `legacy-hidden-${suffix}`;
    db.prepare(`INSERT INTO models
      (model_code,model_name,model_type,status) VALUES (?,?,'llm','active')`)
      .run(hiddenModelCode, 'Legacy hidden model');
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
      .run(channelId, hiddenModelCode, hiddenModelCode);
    const user = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`legacy-model-user-${suffix}`, `legacy-model-user-${suffix}@test.local`,
        bcrypt.hashSync('safe-pass', 4), 'user', 'active');
    const key = db.prepare(`INSERT INTO api_keys
      (user_id,key_name,key_hash,key_prefix,routing_group_id,permission_mode,status)
      VALUES (?,?,?,?,?,'legacy','active')`)
      .run(user.lastInsertRowid, 'legacy-model-key', `legacy-model-hash-${suffix}`,
        'sk-legacy-model', groupId);
    db.prepare(`INSERT INTO api_key_permissions
      (api_key_id,model_code,status) VALUES (?,?,'active')`).run(key.lastInsertRowid, modelCode);
    const token = generateToken({
      id: user.lastInsertRowid, username: `legacy-model-user-${suffix}`, role: 'user',
    });

    const response = await fetch(`${baseUrl}/api/user/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0].models.map(model => model.model_code)).toEqual([modelCode]);
    expect(payload.data.map(model => model.model_code)).toEqual([modelCode]);
  });

  it('跨分组合并模型时同步汇总多模态标记和图片输入能力', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const sharedModelCode = `multimodal-union-${suffix}`;
    db.prepare(`INSERT INTO models
      (model_code,model_name,model_type,is_multimodal,status)
      VALUES (?,?,'llm',1,'active')`).run(sharedModelCode, 'Multimodal union model');
    const groupIds = [];
    for (const supportsImageInput of [0, 1]) {
      const channel = db.prepare(`INSERT INTO upstream_channels
        (channel_name,base_url,api_key,status,protocol_type,capabilities)
        VALUES (?,?,?,'active','openai_compatible','["chat_completions"]')`)
        .run(`multimodal-union-channel-${supportsImageInput}-${suffix}`,
          'https://multimodal-union.test/v1', 'upstream-key');
      db.prepare(`INSERT INTO channel_models
        (channel_id,model_code,upstream_model_name,supports_image_input,status)
        VALUES (?,?,?,?,'active')`)
        .run(channel.lastInsertRowid, sharedModelCode, sharedModelCode, supportsImageInput);
      const group = db.prepare(`INSERT INTO routing_groups
        (group_name,status) VALUES (?,'active')`)
        .run(`multimodal-union-group-${supportsImageInput}-${suffix}`);
      groupIds.push(group.lastInsertRowid);
      db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,status) VALUES (?,?,'active')`)
        .run(group.lastInsertRowid, channel.lastInsertRowid);
      db.prepare(`INSERT INTO api_keys
        (user_id,key_name,key_hash,key_prefix,routing_group_id,permission_mode,status)
        VALUES (?,?,?,?,?,'group_dynamic','active')`)
        .run(userId, `multimodal-union-key-${supportsImageInput}`,
          `multimodal-union-hash-${supportsImageInput}-${suffix}`,
          `sk-multimodal-union-${supportsImageInput}`, group.lastInsertRowid);
    }

    const payload = await listModels();
    const sharedModel = payload.data.find(model => model.model_code === sharedModelCode);
    expect(sharedModel).toMatchObject({
      is_multimodal: true,
      supports_image_input: true,
      capabilities: { image_input: true },
    });
    expect(payload.groups.filter(group => groupIds.includes(group.id))).toHaveLength(2);
  });
});
