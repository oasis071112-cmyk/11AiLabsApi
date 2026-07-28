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
});
