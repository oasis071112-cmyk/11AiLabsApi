import { beforeAll, describe, expect, it } from 'vitest';
import { getDatabase, initDatabase, migrateRoutingGroups } from '../src/database/init.js';
import { reportResult, selectChannel } from '../src/utils/channel-selector.js';
import { listModelsForApiKey } from '../src/utils/routing-group-models.js';

describe('路由分组迁移', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('把旧渠道、模型和 API Key 无损迁移到默认分组', () => {
    const db = getDatabase();
    const suffix = Date.now();
    const channel = db.prepare(`
      INSERT INTO upstream_channels (channel_name,base_url,api_key,priority,weight,status)
      VALUES (?,?,?,?,?,'active')
    `).run(`自定义渠道-${suffix}`, 'https://example.com/v1', 'upstream-secret', 7, 80);
    db.prepare(`
      INSERT INTO models (model_code,model_name,upstream_model_name,channel_id,status)
      VALUES (?,?,?,?,'active')
    `).run(`public-model-${suffix}`, '兼容模型', 'vendor-model', channel.lastInsertRowid);
    const user = db.prepare(`
      INSERT INTO users (username,password_hash,status) VALUES (?,?,'active')
    `).run(`routing-user-${suffix}`, 'hash');
    const key = db.prepare(`
      INSERT INTO api_keys (user_id,key_name,key_hash,key_prefix,status)
      VALUES (?,?,?,?,'active')
    `).run(user.lastInsertRowid, '旧 Key', `hash-${suffix}`, 'sk-test');
    db.prepare(`
      INSERT INTO api_key_permissions (api_key_id,model_code,status)
      VALUES (?,?,'active')
    `).run(key.lastInsertRowid, `public-model-${suffix}`);

    migrateRoutingGroups(db);

    const group = db.prepare(`
      SELECT rg.id,rg.group_name,rgc.priority,rgc.weight
      FROM routing_groups rg
      JOIN routing_group_channels rgc ON rgc.group_id=rg.id
      WHERE rgc.channel_id=?
    `).get(channel.lastInsertRowid);
    expect(group).toMatchObject({
      group_name: `自定义渠道-${suffix}`,
      priority: 7,
      weight: 80
    });

    const mapping = db.prepare(`
      SELECT upstream_model_name,status FROM channel_models
      WHERE channel_id=? AND model_code=?
    `).get(channel.lastInsertRowid, `public-model-${suffix}`);
    expect(mapping).toMatchObject({ upstream_model_name: 'vendor-model', status: 'active' });

    const migratedKey = db.prepare('SELECT routing_group_id,permission_mode FROM api_keys WHERE id=?')
      .get(key.lastInsertRowid);
    expect(migratedKey.routing_group_id).toBe(group.id);
    expect(migratedKey.permission_mode).toBe('legacy');

    const permission = db.prepare(`
      SELECT status FROM api_key_permissions WHERE api_key_id=? AND model_code=?
    `).get(key.lastInsertRowid, `public-model-${suffix}`);
    expect(permission.status).toBe('active');
  });

  it('只在 Key 所属分组内选择支持模型且未熔断的渠道', () => {
    const db = getDatabase();
    const suffix = Date.now();
    const modelCode = `shared-model-${suffix}`;
    db.prepare(`
      INSERT INTO models (model_code,model_name,status) VALUES (?,?,'active')
    `).run(modelCode, '共享模型');
    const healthy = db.prepare(`
      INSERT INTO upstream_channels
        (channel_name,base_url,api_key,status,health_score,protocol_type)
      VALUES (?,?,?,'active',95,'openai_compatible')
    `).run(`健康渠道-${suffix}`, 'https://healthy.example/v1', 'healthy-key');
    const broken = db.prepare(`
      INSERT INTO upstream_channels
        (channel_name,base_url,api_key,status,health_score,circuit_breaker_until,protocol_type)
      VALUES (?,?,?,'active',100,?,'openai_compatible')
    `).run(`熔断渠道-${suffix}`, 'https://broken.example/v1', 'broken-key', '2999-01-01T00:00:00.000Z');
    const outside = db.prepare(`
      INSERT INTO upstream_channels
        (channel_name,base_url,api_key,status,health_score,protocol_type)
      VALUES (?,?,?,'active',100,'openai_compatible')
    `).run(`其他分组渠道-${suffix}`, 'https://outside.example/v1', 'outside-key');
    const lowerPriority = db.prepare(`
      INSERT INTO upstream_channels
        (channel_name,base_url,api_key,status,health_score,protocol_type)
      VALUES (?,?,?,'active',100,'openai_compatible')
    `).run(`低优先渠道-${suffix}`, 'https://low-priority.example/v1', 'low-priority-key');
    for (const [channelId, upstreamName] of [
      [healthy.lastInsertRowid, 'healthy-upstream-model'],
      [broken.lastInsertRowid, 'broken-upstream-model'],
      [outside.lastInsertRowid, 'outside-upstream-model'],
      [lowerPriority.lastInsertRowid, 'low-priority-upstream-model']
    ]) {
      db.prepare(`
        INSERT INTO channel_models (channel_id,model_code,upstream_model_name,status)
        VALUES (?,?,?,'active')
      `).run(channelId, modelCode, upstreamName);
    }
    const group = db.prepare(`
      INSERT INTO routing_groups (group_name,status) VALUES (?,'active')
    `).run(`测试分组-${suffix}`);
    db.prepare(`
      INSERT INTO routing_group_channels (group_id,channel_id,priority,weight,status)
      VALUES (?,?,10,100,'active'),(?,?,20,100,'active'),(?,?,30,100,'active')
    `).run(group.lastInsertRowid, healthy.lastInsertRowid,
      group.lastInsertRowid, broken.lastInsertRowid,
      group.lastInsertRowid, lowerPriority.lastInsertRowid);

    const selected = selectChannel(db, modelCode, group.lastInsertRowid);

    expect(selected.id).toBe(healthy.lastInsertRowid);
    expect(selected.upstream_model_name).toBe('healthy-upstream-model');
    const failover = selectChannel(db, modelCode, group.lastInsertRowid, new Set(),
      new Set([healthy.lastInsertRowid, broken.lastInsertRowid]));
    expect(failover.id).toBe(lowerPriority.lastInsertRowid);
    reportResult(db, healthy.lastInsertRowid, false);
    expect(selectChannel(db, modelCode, group.lastInsertRowid)?.id).toBe(lowerPriority.lastInsertRowid);
  });

  it('开启模型白名单后只调度分组明确允许的模型', () => {
    const db = getDatabase();
    const suffix = Date.now();
    const modelCode = `restricted-model-${suffix}`;
    db.prepare("INSERT INTO models (model_code,model_name,status) VALUES (?,?,'active')").run(modelCode, '限制模型');
    const channel = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,health_score) VALUES (?,?,?,'active',100)`)
      .run(`白名单渠道-${suffix}`, 'https://restricted.example/v1', 'key');
    db.prepare(`INSERT INTO channel_models (channel_id,model_code,upstream_model_name,status)
      VALUES (?,?,?,'active')`).run(channel.lastInsertRowid, modelCode, modelCode);
    const group = db.prepare(`INSERT INTO routing_groups
      (group_name,status,restrict_models) VALUES (?,'active',1)`).run(`白名单分组-${suffix}`);
    db.prepare(`INSERT INTO routing_group_channels
      (group_id,channel_id,status) VALUES (?,?,'active')`).run(group.lastInsertRowid, channel.lastInsertRowid);

    expect(selectChannel(db, modelCode, group.lastInsertRowid)).toBeNull();

    db.prepare(`INSERT INTO routing_group_models (group_id,model_code,status)
      VALUES (?,?,'active')`).run(group.lastInsertRowid, modelCode);
    expect(selectChannel(db, modelCode, group.lastInsertRowid)?.id).toBe(channel.lastInsertRowid);
  });

  it('旧 Key 保留原模型权限，新 Key 使用分组动态权限', () => {
    const db = getDatabase();
    const suffix = Date.now();
    const modelCodes = [`legacy-only-${suffix}`, `group-extra-${suffix}`];
    for (const code of modelCodes) db.prepare("INSERT INTO models (model_code,model_name,status) VALUES (?,?,'active')").run(code, code);
    const channel = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status) VALUES (?,?,?,'active')`).run(`权限渠道-${suffix}`, 'https://permission.example/v1', 'key');
    for (const code of modelCodes) db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'active')`).run(channel.lastInsertRowid, code, code);
    const group = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')").run(`权限分组-${suffix}`);
    db.prepare("INSERT INTO routing_group_channels (group_id,channel_id,status) VALUES (?,?,'active')").run(group.lastInsertRowid, channel.lastInsertRowid);
    const user = db.prepare("INSERT INTO users (username,password_hash,status) VALUES (?,?,'active')").run(`permission-user-${suffix}`, 'hash');
    const legacy = db.prepare(`INSERT INTO api_keys
      (user_id,key_hash,key_prefix,routing_group_id,permission_mode,status) VALUES (?,?,?,?,?,'active')`)
      .run(user.lastInsertRowid, `legacy-hash-${suffix}`, 'sk-legacy', group.lastInsertRowid, 'legacy');
    db.prepare("INSERT INTO api_key_permissions (api_key_id,model_code,status) VALUES (?,?,'active')")
      .run(legacy.lastInsertRowid, modelCodes[0]);
    const dynamic = db.prepare(`INSERT INTO api_keys
      (user_id,key_hash,key_prefix,routing_group_id,permission_mode,status) VALUES (?,?,?,?,?,'active')`)
      .run(user.lastInsertRowid, `dynamic-hash-${suffix}`, 'sk-dynamic', group.lastInsertRowid, 'group_dynamic');

    expect(listModelsForApiKey(db, { id: legacy.lastInsertRowid, routing_group_id: group.lastInsertRowid, permission_mode: 'legacy' }).map(item=>item.model_code))
      .toEqual([modelCodes[0]]);
    expect(listModelsForApiKey(db, { id: dynamic.lastInsertRowid, routing_group_id: group.lastInsertRowid, permission_mode: 'group_dynamic' }).map(item=>item.model_code).sort())
      .toEqual([...modelCodes].sort());
  });

  it('主分组不可用时授权与调度都会进入备用分组', () => {
    const db = getDatabase();
    const suffix = Date.now();
    const modelCode = `fallback-model-${suffix}`;
    db.prepare("INSERT INTO models (model_code,model_name,status) VALUES (?,?,'active')").run(modelCode, '备用模型');
    const channel = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status,health_score) VALUES (?,?,?,'active',100)`)
      .run(`备用渠道-${suffix}`, 'https://fallback.example/v1', 'key');
    db.prepare(`INSERT INTO channel_models (channel_id,model_code,upstream_model_name,status)
      VALUES (?,?,?,'active')`).run(channel.lastInsertRowid, modelCode, modelCode);
    const fallback = db.prepare("INSERT INTO routing_groups (group_name,status) VALUES (?,'active')").run(`备用分组-${suffix}`);
    db.prepare("INSERT INTO routing_group_channels (group_id,channel_id,status) VALUES (?,?,'active')")
      .run(fallback.lastInsertRowid, channel.lastInsertRowid);
    const primary = db.prepare(`INSERT INTO routing_groups
      (group_name,status,restrict_models,fallback_group_id) VALUES (?,'active',1,?)`)
      .run(`主分组-${suffix}`, fallback.lastInsertRowid);
    const key = { id: 999999, routing_group_id: primary.lastInsertRowid, permission_mode: 'group_dynamic' };

    expect(listModelsForApiKey(db, key).map(item=>item.model_code)).toContain(modelCode);
    expect(selectChannel(db, modelCode, primary.lastInsertRowid)?.id).toBe(channel.lastInsertRowid);
  });
});
