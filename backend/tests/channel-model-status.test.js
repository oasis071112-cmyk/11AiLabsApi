import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const adminRoutes = require('../src/routes/admin.js');

describe('渠道模型状态联动', () => {
  let server;
  let baseUrl;
  let adminToken;

  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const admin = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`mapping-admin-${suffix}`, `mapping-admin-${suffix}@test.local`,
        bcrypt.hashSync('safe-pass', 4), 'admin', 'active');
    adminToken = generateToken({
      id: admin.lastInsertRowid, username: `mapping-admin-${suffix}`, role: 'admin',
    });
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

  function createModel(db, suffix, status = 'inactive') {
    const modelCode = `mapping-model-${suffix}`;
    db.prepare(`INSERT INTO models
      (model_code,model_name,billing_multiplier_input,billing_multiplier_output,
       billing_multiplier_image,status)
      VALUES (?,?,1,1,1,?)`).run(modelCode, modelCode, status);
    return modelCode;
  }

  function createChannel(db, suffix, imageMultiplier = 0.35) {
    return db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,billing_multiplier_input,billing_multiplier_output,
       billing_multiplier_image,status)
      VALUES (?,?,?,1,1,?,'active')`)
      .run(`mapping-channel-${suffix}`, `https://${suffix}.test/v1`, 'key', imageMultiplier)
      .lastInsertRowid;
  }

  it('手动新增模型默认下架，旧全局状态接口不再直接改写模型', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = `manual-model-${suffix}`;
    const create = await request('/api/admin/models', {
      method: 'POST',
      body: JSON.stringify({
        model_code: modelCode,
        model_name: modelCode,
        model_type: 'llm',
        official_provider: 'openai',
        official_model_id: modelCode,
        official_pricing_mode: 'auto',
        multiplier_input: 1,
        multiplier_output: 1,
        multiplier_image: 1,
      }),
    });
    expect(create.status).toBe(201);
    const model = getDatabase().prepare('SELECT id,status FROM models WHERE model_code=?')
      .get(modelCode);
    expect(model.status).toBe('inactive');

    const legacyToggle = await request(`/api/admin/models/${model.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'active' }),
    });
    expect(legacyToggle.status).toBe(409);
    expect(getDatabase().prepare('SELECT status FROM models WHERE id=?').get(model.id).status)
      .toBe('inactive');
  });

  it('切换渠道子行时同步派生模型上下架状态，并在模型管理返回渠道来源', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix);
    const channelId = createChannel(db, suffix);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'inactive')`)
      .run(channelId, modelCode, modelCode);

    const enable = await request(`/api/admin/channels/${channelId}/models/${encodeURIComponent(modelCode)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'active' }),
    });
    expect(enable.status).toBe(200);
    expect(db.prepare('SELECT status FROM channel_models WHERE channel_id=? AND model_code=?')
      .get(channelId, modelCode).status).toBe('active');
    expect(db.prepare('SELECT status FROM models WHERE model_code=?').get(modelCode).status).toBe('active');

    const models = (await (await request('/api/admin/models')).json()).data;
    const adminModel = models.find(model => model.model_code === modelCode);
    expect(adminModel.channel_mappings).toEqual([
      expect.objectContaining({
        channel_id: channelId,
        channel_name: `mapping-channel-${suffix}`,
        status: 'active',
      }),
    ]);

    const disable = await request(`/api/admin/channels/${channelId}/models/${encodeURIComponent(modelCode)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'inactive' }),
    });
    expect(disable.status).toBe(200);
    expect(db.prepare('SELECT status FROM models WHERE model_code=?').get(modelCode).status).toBe('inactive');
  });

  it('同一路由分组不允许同一模型同时启用两个渠道映射', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const firstChannelId = createChannel(db, `${suffix}-a`);
    const secondChannelId = createChannel(db, `${suffix}-b`);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
      .run(firstChannelId, modelCode, modelCode);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'inactive')`)
      .run(secondChannelId, modelCode, modelCode);
    const groupId = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')")
      .run(`mapping-group-${suffix}`).lastInsertRowid;
    db.prepare(`INSERT INTO routing_group_channels
      (group_id,channel_id,status) VALUES (?,?,'active'),(?,?,'active')`)
      .run(groupId, firstChannelId, groupId, secondChannelId);

    const response = await request(`/api/admin/channels/${secondChannelId}/models/${encodeURIComponent(modelCode)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'active' }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('同一路由分组');
  });

  it('跨分组最终倍率不一致时阻止启用映射', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const firstChannelId = createChannel(db, `${suffix}-a`, 0.35);
    const secondChannelId = createChannel(db, `${suffix}-b`, 0.3);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
      .run(firstChannelId, modelCode, modelCode);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'inactive')`)
      .run(secondChannelId, modelCode, modelCode);
    for (const [label, channelId] of [['a', firstChannelId], ['b', secondChannelId]]) {
      const groupId = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')")
        .run(`mapping-group-${suffix}-${label}`).lastInsertRowid;
      db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,status) VALUES (?,?,'active')`).run(groupId, channelId);
    }

    const response = await request(`/api/admin/channels/${secondChannelId}/models/${encodeURIComponent(modelCode)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'active' }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('倍率');
  });

  it('修改渠道倍率会造成跨分组不一致时回滚保存', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const firstChannelId = createChannel(db, `${suffix}-a`, 0.35);
    const secondChannelId = createChannel(db, `${suffix}-b`, 0.35);
    for (const channelId of [firstChannelId, secondChannelId]) {
      db.prepare(`INSERT INTO channel_models
        (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
        .run(channelId, modelCode, modelCode);
      const groupId = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')")
        .run(`mapping-group-${suffix}-${channelId}`).lastInsertRowid;
      db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,status) VALUES (?,?,'active')`).run(groupId, channelId);
    }

    const response = await request(`/api/admin/channels/${secondChannelId}`, {
      method: 'PUT',
      body: JSON.stringify({
        channel_name: `mapping-channel-${suffix}-b`,
        base_url: `https://${suffix}-b.test/v1`,
        api_key: '',
        priority: 0,
        weight: 100,
        protocol_type: 'openai_compatible',
        capabilities: ['chat_completions'],
        billing_multiplier_input: 1,
        billing_multiplier_output: 1,
        billing_multiplier_image: 0.4,
      }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('倍率');
    expect(db.prepare('SELECT billing_multiplier_image FROM upstream_channels WHERE id=?')
      .get(secondChannelId).billing_multiplier_image).toBe(0.35);
  });

  it('创建号池时拒绝同一模型的两个启用渠道', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const firstChannelId = createChannel(db, `${suffix}-a`, 0.35);
    const secondChannelId = createChannel(db, `${suffix}-b`, 0.35);
    for (const channelId of [firstChannelId, secondChannelId]) {
      db.prepare(`INSERT INTO channel_models
        (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
        .run(channelId, modelCode, modelCode);
    }

    const response = await request('/api/admin/routing-groups', {
      method: 'POST',
      body: JSON.stringify({
        group_name: `mapping-group-${suffix}`,
        status: 'active',
        channels: [
          { channel_id: firstChannelId, status: 'active' },
          { channel_id: secondChannelId, status: 'active' },
        ],
      }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('同一路由分组');
  });

  it('平台倍率规则变更会造成渠道最终倍率不一致时回滚', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const explicitChannelId = createChannel(db, `${suffix}-explicit`, 0.35);
    const fallbackChannelId = createChannel(db, `${suffix}-fallback`, null);
    for (const channelId of [explicitChannelId, fallbackChannelId]) {
      db.prepare(`INSERT INTO channel_models
        (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
        .run(channelId, modelCode, modelCode);
      const groupId = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')")
        .run(`mapping-group-${suffix}-${channelId}`).lastInsertRowid;
      db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,status) VALUES (?,?,'active')`).run(groupId, channelId);
    }
    const ruleId = db.prepare(`INSERT INTO pricing_rules
      (rule_name,model_code,scope_type,billing_multiplier_input,billing_multiplier_output,
       billing_multiplier_image,priority,status)
      VALUES (?,?,'platform',1,1,0.35,10,'active')`)
      .run(`mapping-rule-${suffix}`, modelCode).lastInsertRowid;

    const response = await request(`/api/admin/pricing-rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify({
        rule_name: `mapping-rule-${suffix}`,
        model_code: modelCode,
        scope_type: 'platform',
        multiplier_input: 1,
        multiplier_output: 1,
        multiplier_image: 0.3,
        priority: 10,
        status: 'active',
      }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('倍率');
    expect(db.prepare('SELECT billing_multiplier_image FROM pricing_rules WHERE id=?')
      .get(ruleId).billing_multiplier_image).toBe(0.35);
  });

  it('删除最后一个渠道映射时同步下架父模型', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const channelId = createChannel(db, suffix);
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
      .run(channelId, modelCode, modelCode);

    const response = await request(`/api/admin/channels/${channelId}`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT status FROM models WHERE model_code=?').get(modelCode).status)
      .toBe('inactive');
  });

  it('拒绝未来生效后会造成跨分组倍率不一致的平台规则', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const explicitChannelId = createChannel(db, `${suffix}-explicit`, 0.35);
    const fallbackChannelId = createChannel(db, `${suffix}-fallback`, null);
    for (const channelId of [explicitChannelId, fallbackChannelId]) {
      db.prepare(`INSERT INTO channel_models
        (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
        .run(channelId, modelCode, modelCode);
      const groupId = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')")
        .run(`scheduled-group-${suffix}-${channelId}`).lastInsertRowid;
      db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,status) VALUES (?,?,'active')`).run(groupId, channelId);
    }
    db.prepare(`INSERT INTO pricing_rules
      (rule_name,model_code,scope_type,billing_multiplier_input,billing_multiplier_output,
       billing_multiplier_image,priority,status)
      VALUES (?,?,'platform',1,1,0.35,10,'active')`)
      .run(`scheduled-baseline-${suffix}`, modelCode);

    const response = await request('/api/admin/pricing-rules', {
      method: 'POST',
      body: JSON.stringify({
        rule_name: `scheduled-future-${suffix}`,
        model_code: modelCode,
        scope_type: 'platform',
        multiplier_input: 1,
        multiplier_output: 1,
        multiplier_image: 0.3,
        priority: 20,
        start_time: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'active',
      }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('倍率');
    expect(db.prepare('SELECT id FROM pricing_rules WHERE rule_name=?')
      .get(`scheduled-future-${suffix}`)).toBeNull();
  });

  it('拒绝到期后会造成跨分组倍率不一致的平台规则', async () => {
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    const modelCode = createModel(db, suffix, 'active');
    const explicitChannelId = createChannel(db, `${suffix}-explicit`, 0.35);
    const fallbackChannelId = createChannel(db, `${suffix}-fallback`, null);
    for (const channelId of [explicitChannelId, fallbackChannelId]) {
      db.prepare(`INSERT INTO channel_models
        (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`)
        .run(channelId, modelCode, modelCode);
      const groupId = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')")
        .run(`expiring-group-${suffix}-${channelId}`).lastInsertRowid;
      db.prepare(`INSERT INTO routing_group_channels
        (group_id,channel_id,status) VALUES (?,?,'active')`).run(groupId, channelId);
    }

    const response = await request('/api/admin/pricing-rules', {
      method: 'POST',
      body: JSON.stringify({
        rule_name: `expiring-rule-${suffix}`,
        model_code: modelCode,
        scope_type: 'platform',
        multiplier_input: 1,
        multiplier_output: 1,
        multiplier_image: 0.35,
        priority: 10,
        end_time: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'active',
      }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('倍率');
    expect(db.prepare('SELECT id FROM pricing_rules WHERE rule_name=?')
      .get(`expiring-rule-${suffix}`)).toBeNull();
  });
});
