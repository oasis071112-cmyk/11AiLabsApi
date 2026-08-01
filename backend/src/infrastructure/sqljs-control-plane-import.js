const fs = require('node:fs');
const crypto = require('node:crypto');

const CONTROL_PLANE_USER_ROLES = new Set(['admin', 'operator', 'finance']);
const EXCLUDED_USER_PLANE_TABLES = ['api_keys', 'api_key_permissions', 'wallets', 'wallet_transactions', 'quota_orders', 'api_request_logs'];

function jsonValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (error) { return value; }
}

function stableKey(...parts) {
  return parts.map(part => String(part ?? '').trim()).join(':');
}

function finiteNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = finiteNumber(value, fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = finiteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function optionalNonNegativeInteger(value) {
  const parsed = optionalNonNegativeNumber(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function jsonObject(value) {
  const parsed = jsonValue(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
}

function legacyUtcTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const naiveUtc = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  if (naiveUtc) return new Date(`${naiveUtc[1]}T${naiveUtc[2]}Z`).toISOString();
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_error) {
    return [];
  }
}

function importRecord(entity, naturalKey, value) {
  return Object.freeze({ entity, naturalKey: Object.freeze(naturalKey), value: Object.freeze(value) });
}

function buildControlPlaneImportPlan(snapshot = {}) {
  const records = [];
  for (const user of snapshot.staffUsers || []) {
    if (!CONTROL_PLANE_USER_ROLES.has(user.role)) continue;
    records.push(importRecord('staff_user', { username: user.username }, {
      username: user.username,
      email: user.email || `${user.username}@import.invalid`,
      passwordHash: user.password_hash,
      role: user.role,
      status: user.status === 'active' ? 'active' : 'disabled',
    }));
  }
  for (const model of snapshot.models || []) {
    records.push(importRecord('model', { modelCode: model.model_code }, {
      modelCode: model.model_code,
      modelName: model.model_name,
      provider: model.official_provider || model.provider || 'legacy',
      modelType: model.model_type || 'llm',
      status: model.status === 'active' ? 'active' : 'inactive',
      metadata: model,
      contextLength: optionalNonNegativeInteger(model.context_length),
      sortOrder: optionalNonNegativeInteger(model.sort_order) || 0,
      capabilities: jsonObject(model.capabilities),
      officialProvider: model.official_provider || null,
      officialCurrency: model.official_currency || null,
      officialInputPrice: optionalNonNegativeNumber(model.official_input_price),
      officialOutputPrice: optionalNonNegativeNumber(model.official_output_price),
      officialCachedInputPrice: optionalNonNegativeNumber(model.official_cached_input_price),
      officialUnitTokens: optionalNonNegativeInteger(model.official_unit_tokens),
      officialPriceUpdatedAt: legacyUtcTimestamp(model.official_price_updated_at),
    }));
  }
  for (const rule of snapshot.pricingRules || []) {
    if (rule.scope_type && rule.scope_type !== 'platform') continue;
    const ruleKey = stableKey('platform', rule.model_code || '*', rule.rule_name);
    records.push(importRecord('pricing_rule', { ruleKey }, {
      ruleKey,
      modelCode: rule.model_code || null,
      billingMode: rule.billing_mode || 'token',
      rule,
      status: rule.status === 'active' ? 'active' : 'inactive',
    }));
  }
  const settings = new Map((snapshot.systemConfig || []).map(setting => [setting.config_key, setting]));
  settings.set('payment_enabled', { config_key: 'payment_enabled', config_value: false, description: 'SQL.js 控制面导入后默认关闭在线支付' });
  for (const setting of settings.values()) {
    records.push(importRecord('system_config', { configKey: setting.config_key }, {
      configKey: setting.config_key,
      configValue: setting.config_key === 'payment_enabled' ? false : jsonValue(setting.config_value),
      description: setting.description || '',
    }));
  }
  for (const channel of snapshot.upstreamChannels || []) {
    const accountKey = channel.channel_name;
    records.push(importRecord('upstream_account', { accountKey }, {
      accountKey,
      displayName: channel.channel_name,
      baseUrl: channel.base_url,
      protocolType: channel.protocol_type || 'openai_compatible',
      capabilities: jsonValue(channel.capabilities) || [],
      status: channel.status === 'active' ? 'active' : 'inactive',
      maxConcurrency: nonNegativeInteger(channel.max_concurrency, 1),
      rpmLimit: nonNegativeInteger(channel.rpm_limit, 60),
      tpmLimit: nonNegativeInteger(channel.tpm_limit, 100000),
      cooldownSeconds: nonNegativeInteger(channel.cooldown_seconds, 60),
      priority: nonNegativeInteger(channel.priority, 0),
      weight: positiveNumber(channel.weight, 100),
      secretPresent: Boolean(channel.api_key),
    }));
  }
  for (const mapping of snapshot.channelModels || []) {
    records.push(importRecord('account_model', { accountKey: mapping.channel_name, modelCode: mapping.model_code }, {
      accountKey: mapping.channel_name,
      modelCode: mapping.model_code,
      upstreamModelName: mapping.upstream_model_name,
      supportsImageInput: Boolean(mapping.supports_image_input),
      configuration: mapping,
      status: mapping.status === 'active' ? 'active' : 'inactive',
    }));
  }
  for (const group of snapshot.routingGroups || []) {
    records.push(importRecord('routing_group', { groupKey: group.group_name }, {
      groupKey: group.group_name,
      groupName: group.group_name,
      protocolType: group.protocol_type || 'openai_compatible',
      status: group.status === 'active' ? 'active' : 'inactive',
      description: group.description || '',
      configuration: group,
      restrictModels: Boolean(group.restrict_models),
      billingMultiplierInput: positiveNumber(group.billing_multiplier_input, 1),
      billingMultiplierOutput: positiveNumber(group.billing_multiplier_output, 1),
      billingMultiplierImage: positiveNumber(group.billing_multiplier_image, 1),
    }));
  }
  for (const group of snapshot.routingGroups || []) {
    if (!group.fallback_group_name) continue;
    records.push(importRecord('routing_group_fallback', { groupKey: group.group_name }, {
      groupKey: group.group_name,
      fallbackGroupKey: group.fallback_group_name,
    }));
  }
  for (const membership of snapshot.routingGroupChannels || []) {
    records.push(importRecord('routing_group_account', {
      groupKey: membership.group_name,
      accountKey: membership.channel_name,
    }, {
      groupKey: membership.group_name,
      accountKey: membership.channel_name,
      priority: Number(membership.priority || 0),
      weight: Math.max(1, Number(membership.weight || 100)),
      status: membership.status === 'active' ? 'active' : 'inactive',
    }));
  }
  for (const membership of snapshot.routingGroupModels || []) {
    records.push(importRecord('routing_group_model', {
      groupKey: membership.group_name,
      modelCode: membership.model_code,
    }, {
      groupKey: membership.group_name,
      modelCode: membership.model_code,
      status: membership.status === 'active' ? 'active' : 'inactive',
      billingMultiplier: optionalPositiveNumber(membership.billing_multiplier),
      billingMultiplierInput: optionalPositiveNumber(membership.billing_multiplier_input),
      billingMultiplierOutput: optionalPositiveNumber(membership.billing_multiplier_output),
      billingMultiplierImage: optionalPositiveNumber(membership.billing_multiplier_image),
    }));
  }
  for (const provider of snapshot.paymentProviders || []) {
    const providerCode = stableKey(provider.provider_type, provider.provider_name);
    records.push(importRecord('payment_provider', { providerCode }, {
      providerCode,
      providerName: provider.provider_name,
      providerType: provider.provider_type,
      config: {
        api_base_url: provider.api_base_url || '',
        merchant_id: provider.merchant_id || '',
        enabled_methods: stringArray(provider.enabled_methods),
        alipay_type: provider.alipay_type || '',
        wechat_type: provider.wechat_type || '',
      },
      secretPresent: Boolean(provider.merchant_key_encrypted),
      secretEnvelope: null,
      secretVersion: null,
      status: 'disabled',
    }));
  }
  return Object.freeze({
    records: Object.freeze(records),
    excludedUserPlaneCounts: Object.freeze({ ...(snapshot.excludedUserPlaneCounts || {}) }),
    paymentEnabled: false,
  });
}

function summarizePlan(plan) {
  const recordsByEntity = {};
  for (const record of plan.records) recordsByEntity[record.entity] = (recordsByEntity[record.entity] || 0) + 1;
  return { recordsByEntity, excludedUserPlaneCounts: plan.excludedUserPlaneCounts, paymentEnabled: false };
}

function accountSecrets(snapshot) {
  return new Map((snapshot.upstreamChannels || []).map(channel => [channel.channel_name, channel.api_key]));
}

function paymentSecrets(snapshot) {
  return new Map((snapshot.paymentProviders || []).map(provider => [
    stableKey(provider.provider_type, provider.provider_name),
    provider.merchant_key_encrypted || null,
  ]));
}

function materializeRecord(record, secrets, secretBox, decodePaymentSecret) {
  if (record.entity === 'payment_provider') {
    const legacyEnvelope = secrets.payments.get(record.value.providerCode);
    const { secretPresent, ...value } = record.value;
    if (!legacyEnvelope) return importRecord(record.entity, record.naturalKey, value);
    if (!secretBox || typeof decodePaymentSecret !== 'function') {
      throw new Error(`Payment provider ${record.value.providerCode} requires legacy decryption and a new keyring`);
    }
    const plaintext = decodePaymentSecret(legacyEnvelope);
    if (!plaintext) throw new Error(`Payment provider ${record.value.providerCode} decrypted to an empty secret`);
    return importRecord(record.entity, record.naturalKey, {
      ...value,
      secretEnvelope: secretBox.seal(plaintext, { aad: `payment_providers:${record.value.providerCode}` }),
      secretVersion: secretBox.activeVersion,
    });
  }
  if (record.entity !== 'upstream_account') return record;
  const sourceSecret = secrets.accounts.get(record.value.accountKey);
  if (!sourceSecret) throw new Error(`上游账号 ${record.value.accountKey} 缺少 API Key，拒绝导入不完整账号`);
  if (!secretBox) throw new Error('应用上游账号导入必须提供版本化 AES-256-GCM 密钥盒');
  const { secretPresent, ...value } = record.value;
  return importRecord(record.entity, record.naturalKey, {
    ...value,
    apiKeyEnvelope: secretBox.seal(sourceSecret, { aad: `upstream_accounts:${record.value.accountKey}` }),
    secretVersion: secretBox.activeVersion,
  });
}

async function executeControlPlaneImport({
  snapshot, sink, dryRun = true, secretBox, decodePaymentSecret,
  importedBy = 'sqljs-control-plane-import',
} = {}) {
  const plan = buildControlPlaneImportPlan(snapshot);
  const summary = summarizePlan(plan);
  if (dryRun) return { dryRun: true, ...summary };
  if (!sink || typeof sink.upsert !== 'function' || typeof sink.insertAudit !== 'function'
    || typeof sink.verify !== 'function') {
    throw new Error('正式导入必须提供支持 upsert、verify 和 insertAudit 的目标服务');
  }
  const secrets = { accounts: accountSecrets(snapshot), payments: paymentSecrets(snapshot) };
  for (const record of plan.records) {
    const result = await sink.upsert(materializeRecord(record, secrets, secretBox, decodePaymentSecret));
    if (result && typeof result.rowCount === 'number' && result.rowCount < 1) {
      throw new Error(`控制面记录未写入: ${record.entity} ${JSON.stringify(record.naturalKey)}`);
    }
  }
  const verification = await sink.verify({ plan, secretBox });
  const audit = {
    auditKey: `sqljs-control-plane-import:${crypto.randomUUID()}`,
    action: 'sqljs_control_plane_import',
    payload: { ...summary, importedBy, verification },
  };
  await sink.insertAudit(audit);
  return { dryRun: false, ...summary, verification, auditKey: audit.auditKey };
}

function rowsFromSqlJs(database, table) {
  const result = database.exec(`SELECT * FROM ${table}`)[0];
  if (!result) return [];
  return result.values.map(values => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])));
}

function hasSqlJsTable(database, table) {
  const statement = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  try {
    statement.bind([table]);
    return statement.step();
  } finally {
    statement.free();
  }
}

function tableRows(database, table) {
  return hasSqlJsTable(database, table) ? rowsFromSqlJs(database, table) : [];
}

function legacyControlPlaneSnapshot(database) {
  const users = tableRows(database, 'users');
  const channels = tableRows(database, 'upstream_channels');
  const channelNameById = new Map(channels.map(channel => [channel.id, channel.channel_name]));
  const groups = tableRows(database, 'routing_groups');
  const groupNameById = new Map(groups.map(group => [group.id, group.group_name]));
  const counts = Object.fromEntries(EXCLUDED_USER_PLANE_TABLES.map(table => [table, tableRows(database, table).length]));
  return {
    staffUsers: users,
    models: tableRows(database, 'models'),
    pricingRules: tableRows(database, 'pricing_rules'),
    systemConfig: tableRows(database, 'system_config'),
    upstreamChannels: channels,
    channelModels: tableRows(database, 'channel_models').map(row => ({ ...row, channel_name: channelNameById.get(row.channel_id) })),
    routingGroups: groups.map(group => ({
      ...group,
      fallback_group_name: groupNameById.get(group.fallback_group_id) || null,
    })),
    routingGroupChannels: tableRows(database, 'routing_group_channels').map(row => ({
      ...row,
      group_name: groupNameById.get(row.group_id),
      channel_name: channelNameById.get(row.channel_id),
    })),
    routingGroupModels: tableRows(database, 'routing_group_models').map(row => ({ ...row, group_name: groupNameById.get(row.group_id) })),
    paymentProviders: tableRows(database, 'payment_providers'),
    excludedUserPlaneCounts: counts,
  };
}

async function loadSqlJsControlPlaneSnapshot({ sourcePath, initSqlJs } = {}) {
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('SQL.js 源数据库不存在');
  const initialize = initSqlJs || require('sql.js');
  const SQL = await initialize();
  const database = new SQL.Database(fs.readFileSync(sourcePath));
  try {
    return legacyControlPlaneSnapshot(database);
  } finally {
    database.close();
  }
}

function createPostgresControlPlaneSink(client) {
  if (!client || typeof client.query !== 'function') throw new Error('PostgreSQL 导入目标必须提供 query()');
  const assertSetEqual = (label, expected, actual) => {
    const expectedSet = new Set(expected.map(String));
    const actualSet = new Set(actual.map(String));
    const missing = [...expectedSet].filter(value => !actualSet.has(value));
    const unexpected = [...actualSet].filter(value => !expectedSet.has(value));
    if (missing.length || unexpected.length) {
      throw new Error(`${label} 导入核对失败: missing=${missing.join('|') || '-'} unexpected=${unexpected.join('|') || '-'}`);
    }
  };
  const assertImportedValue = (label, expected, actual) => {
    if (typeof expected === 'number' && Number.isFinite(expected) && Number.isFinite(Number(actual))) {
      if (expected === Number(actual)) return;
    }
    const expectedValue = expected === null || expected === undefined ? null : String(expected);
    const actualValue = actual === null || actual === undefined ? null : String(actual);
    if (expectedValue !== actualValue) {
      throw new Error(`${label} 导入核对失败: expected=${expectedValue ?? 'null'} actual=${actualValue ?? 'null'}`);
    }
  };
  const assertImportedJson = (label, expected, actual) => {
    const expectedJson = JSON.stringify(canonicalJson(expected ?? {}));
    const actualJson = JSON.stringify(canonicalJson(actual ?? {}));
    if (expectedJson !== actualJson) {
      throw new Error(`${label} 导入核对失败: expected=${expectedJson} actual=${actualJson}`);
    }
  };
  const assertImportedTimestamp = (label, expected, actual) => {
    if (expected === null || expected === undefined || expected === '') {
      assertImportedValue(label, null, actual);
      return;
    }
    const expectedTime = new Date(expected).getTime();
    const actualTime = new Date(actual).getTime();
    if (!Number.isFinite(expectedTime) || expectedTime !== actualTime) {
      throw new Error(`${label} 导入核对失败: expected=${expected} actual=${actual ?? 'null'}`);
    }
  };
  return {
    async upsert(record) {
      const value = record.value;
      switch (record.entity) {
        case 'staff_user':
          return client.query(`INSERT INTO staff_users (username,email,password_hash,role,status)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (username) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,status=EXCLUDED.status,updated_at=CURRENT_TIMESTAMP`,
          [value.username, value.email, value.passwordHash, value.role, value.status]);
        case 'model':
          return client.query(`INSERT INTO models
            (model_code,model_name,provider,model_type,status,metadata,context_length,sort_order,capabilities,
              official_provider,official_currency,official_input_price,official_output_price,official_cached_input_price,
              official_unit_tokens,official_price_updated_at)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (model_code) DO UPDATE SET model_name=EXCLUDED.model_name,provider=EXCLUDED.provider,
              model_type=EXCLUDED.model_type,status=EXCLUDED.status,metadata=EXCLUDED.metadata,
              context_length=EXCLUDED.context_length,sort_order=EXCLUDED.sort_order,capabilities=EXCLUDED.capabilities,
              official_provider=EXCLUDED.official_provider,official_currency=EXCLUDED.official_currency,
              official_input_price=EXCLUDED.official_input_price,official_output_price=EXCLUDED.official_output_price,
              official_cached_input_price=EXCLUDED.official_cached_input_price,official_unit_tokens=EXCLUDED.official_unit_tokens,
              official_price_updated_at=EXCLUDED.official_price_updated_at,updated_at=CURRENT_TIMESTAMP`,
          [value.modelCode, value.modelName, value.provider, value.modelType, value.status, JSON.stringify(value.metadata),
            value.contextLength, value.sortOrder, JSON.stringify(value.capabilities), value.officialProvider,
            value.officialCurrency, value.officialInputPrice, value.officialOutputPrice, value.officialCachedInputPrice,
            value.officialUnitTokens, value.officialPriceUpdatedAt]);
        case 'pricing_rule':
          return client.query(`INSERT INTO pricing_rules (rule_key,model_code,billing_mode,rule,status)
            VALUES ($1,$2,$3,$4::jsonb,$5)
            ON CONFLICT (rule_key) DO UPDATE SET model_code=EXCLUDED.model_code,billing_mode=EXCLUDED.billing_mode,rule=EXCLUDED.rule,status=EXCLUDED.status,updated_at=CURRENT_TIMESTAMP`,
          [value.ruleKey, value.modelCode, value.billingMode, JSON.stringify(value.rule), value.status]);
        case 'system_config':
          return client.query(`INSERT INTO system_config (config_key,config_value,description)
            VALUES ($1,$2::jsonb,$3)
            ON CONFLICT (config_key) DO UPDATE SET config_value=EXCLUDED.config_value,description=EXCLUDED.description,updated_at=CURRENT_TIMESTAMP`,
          [value.configKey, JSON.stringify(value.configValue), value.description]);
        case 'upstream_account':
          return client.query(`INSERT INTO upstream_accounts
            (account_key,display_name,base_url,protocol_type,api_key_envelope,secret_version,capabilities,status,
              max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
            ON CONFLICT (account_key) DO UPDATE SET display_name=EXCLUDED.display_name,base_url=EXCLUDED.base_url,
              protocol_type=EXCLUDED.protocol_type,api_key_envelope=EXCLUDED.api_key_envelope,secret_version=EXCLUDED.secret_version,
              capabilities=EXCLUDED.capabilities,status=EXCLUDED.status,max_concurrency=EXCLUDED.max_concurrency,
              rpm_limit=EXCLUDED.rpm_limit,tpm_limit=EXCLUDED.tpm_limit,cooldown_seconds=EXCLUDED.cooldown_seconds,
              priority=EXCLUDED.priority,weight=EXCLUDED.weight,updated_at=CURRENT_TIMESTAMP`,
          [value.accountKey, value.displayName, value.baseUrl, value.protocolType, value.apiKeyEnvelope, value.secretVersion,
            JSON.stringify(value.capabilities), value.status, value.maxConcurrency, value.rpmLimit, value.tpmLimit,
            value.cooldownSeconds, value.priority, value.weight]);
        case 'account_model':
          return client.query(`INSERT INTO account_models (account_id,model_code,upstream_model_name,supports_image_input,configuration,status)
            SELECT id,$2,$3,$4,$5::jsonb,$6 FROM upstream_accounts WHERE account_key=$1
            ON CONFLICT (account_id,model_code) DO UPDATE SET upstream_model_name=EXCLUDED.upstream_model_name,supports_image_input=EXCLUDED.supports_image_input,configuration=EXCLUDED.configuration,status=EXCLUDED.status`,
          [value.accountKey, value.modelCode, value.upstreamModelName, value.supportsImageInput, JSON.stringify(value.configuration), value.status]);
        case 'routing_group':
          return client.query(`INSERT INTO routing_groups
            (group_key,group_name,protocol_type,status,description,configuration,restrict_models,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
            ON CONFLICT (group_key) DO UPDATE SET group_name=EXCLUDED.group_name,protocol_type=EXCLUDED.protocol_type,status=EXCLUDED.status,
              description=EXCLUDED.description,configuration=EXCLUDED.configuration,restrict_models=EXCLUDED.restrict_models,
              billing_multiplier_input=EXCLUDED.billing_multiplier_input,billing_multiplier_output=EXCLUDED.billing_multiplier_output,
              billing_multiplier_image=EXCLUDED.billing_multiplier_image,updated_at=CURRENT_TIMESTAMP`,
          [value.groupKey, value.groupName, value.protocolType, value.status, value.description, JSON.stringify(value.configuration), value.restrictModels,
            value.billingMultiplierInput, value.billingMultiplierOutput, value.billingMultiplierImage]);
        case 'routing_group_fallback':
          return client.query(`UPDATE routing_groups source SET fallback_group_id=fallback.id,updated_at=CURRENT_TIMESTAMP
            FROM routing_groups fallback WHERE source.group_key=$1 AND fallback.group_key=$2`,
          [value.groupKey, value.fallbackGroupKey]);
        case 'routing_group_account':
          return client.query(`INSERT INTO routing_group_accounts (routing_group_id,account_id,priority,weight,status)
            SELECT rg.id,ua.id,$3,$4,$5 FROM routing_groups rg CROSS JOIN upstream_accounts ua WHERE rg.group_key=$1 AND ua.account_key=$2
            ON CONFLICT (routing_group_id,account_id) DO UPDATE SET priority=EXCLUDED.priority,weight=EXCLUDED.weight,status=EXCLUDED.status`,
          [value.groupKey, value.accountKey, value.priority, value.weight, value.status]);
        case 'routing_group_model':
          return client.query(`INSERT INTO routing_group_models
            (routing_group_id,model_code,status,billing_multiplier,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image)
            SELECT id,$2,$3,$4,$5,$6,$7 FROM routing_groups WHERE group_key=$1
            ON CONFLICT (routing_group_id,model_code) DO UPDATE SET status=EXCLUDED.status,
              billing_multiplier=EXCLUDED.billing_multiplier,billing_multiplier_input=EXCLUDED.billing_multiplier_input,
              billing_multiplier_output=EXCLUDED.billing_multiplier_output,billing_multiplier_image=EXCLUDED.billing_multiplier_image`,
          [value.groupKey, value.modelCode, value.status, value.billingMultiplier, value.billingMultiplierInput,
            value.billingMultiplierOutput, value.billingMultiplierImage]);
        case 'payment_provider':
          return client.query(`INSERT INTO payment_providers (provider_code,provider_name,provider_type,config,secret_envelope,secret_version,status)
            VALUES ($1,$2,$3,$4::jsonb,$5,$6,'disabled')
            ON CONFLICT (provider_code) DO UPDATE SET provider_name=EXCLUDED.provider_name,provider_type=EXCLUDED.provider_type,config=EXCLUDED.config,
              secret_envelope=COALESCE(EXCLUDED.secret_envelope,payment_providers.secret_envelope),
              secret_version=COALESCE(EXCLUDED.secret_version,payment_providers.secret_version),status='disabled',updated_at=CURRENT_TIMESTAMP`,
          [value.providerCode, value.providerName, value.providerType, JSON.stringify(value.config), value.secretEnvelope, value.secretVersion]);
        default:
          throw new Error(`不支持的控制面导入实体 ${record.entity}`);
      }
    },
    async insertAudit(audit) {
      return client.query('INSERT INTO audit_logs (audit_key,action,payload) VALUES ($1,$2,$3::jsonb)',
        [audit.auditKey, audit.action, JSON.stringify(audit.payload)]);
    },
    async verify({ plan, secretBox }) {
      const expected = entity => plan.records.filter(record => record.entity === entity);
      // A PostgreSQL transaction client is a single connection. Running these
      // verification reads concurrently is deprecated by pg and can interleave
      // protocol messages, so keep the audit boundary deliberately sequential.
      const staff = await client.query('SELECT username FROM staff_users ORDER BY username');
      const models = await client.query(`SELECT model_code,context_length,sort_order,capabilities,official_provider,
        official_currency,official_input_price,official_output_price,official_cached_input_price,official_unit_tokens,
        official_price_updated_at FROM models ORDER BY model_code`);
      const prices = await client.query('SELECT rule_key FROM pricing_rules ORDER BY rule_key');
      const configs = await client.query('SELECT config_key,config_value FROM system_config ORDER BY config_key');
      const accounts = await client.query(`SELECT account_key,api_key_envelope,max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight
        FROM upstream_accounts ORDER BY account_key`);
      const mappings = await client.query(`SELECT ua.account_key,am.model_code,am.upstream_model_name,am.supports_image_input,am.status FROM account_models am
        JOIN upstream_accounts ua ON ua.id=am.account_id ORDER BY ua.account_key,am.model_code`);
      const groups = await client.query(`SELECT rg.group_key,fallback.group_key AS fallback_group_key,rg.description,rg.restrict_models,
          rg.billing_multiplier_input,rg.billing_multiplier_output,rg.billing_multiplier_image
        FROM routing_groups rg LEFT JOIN routing_groups fallback ON fallback.id=rg.fallback_group_id ORDER BY rg.group_key`);
      const members = await client.query(`SELECT rg.group_key,ua.account_key,rga.priority,rga.weight,rga.status FROM routing_group_accounts rga
        JOIN routing_groups rg ON rg.id=rga.routing_group_id JOIN upstream_accounts ua ON ua.id=rga.account_id
        ORDER BY rg.group_key,ua.account_key`);
      const groupModels = await client.query(`SELECT rg.group_key,rgm.model_code,rgm.status,rgm.billing_multiplier,
          rgm.billing_multiplier_input,rgm.billing_multiplier_output,rgm.billing_multiplier_image
        FROM routing_group_models rgm
        JOIN routing_groups rg ON rg.id=rgm.routing_group_id ORDER BY rg.group_key,rgm.model_code`);
      const payments = await client.query('SELECT provider_code,secret_envelope,status FROM payment_providers ORDER BY provider_code');
      const userPlane = await client.query(`SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM wallets) AS wallets,
          (SELECT COUNT(*) FROM wallet_transactions) AS wallet_transactions,
          (SELECT COUNT(*) FROM quota_orders) AS quota_orders,
          (SELECT COUNT(*) FROM api_keys) AS api_keys,
          (SELECT COUNT(*) FROM api_key_permissions) AS api_key_permissions,
          (SELECT COUNT(*) FROM api_request_logs) AS api_request_logs,
          (SELECT COUNT(*) FROM usage_reservations) AS usage_reservations,
          (SELECT COUNT(*) FROM user_daily_usage) AS user_daily_usage,
          (SELECT COUNT(*) FROM platform_daily_usage) AS platform_daily_usage,
          (SELECT COUNT(*) FROM upstream_account_probes) AS upstream_account_probes,
          (SELECT COUNT(*) FROM audit_logs) AS audit_logs`);
      assertSetEqual('staff_users', expected('staff_user').map(record => record.value.username), staff.rows.map(row => row.username));
      assertSetEqual('models', expected('model').map(record => record.value.modelCode), models.rows.map(row => row.model_code));
      assertSetEqual('pricing_rules', expected('pricing_rule').map(record => record.value.ruleKey), prices.rows.map(row => row.rule_key));
      assertSetEqual('upstream_accounts', expected('upstream_account').map(record => record.value.accountKey), accounts.rows.map(row => row.account_key));
      assertSetEqual('account_models', expected('account_model').map(record => `${record.value.accountKey}:${record.value.modelCode}`), mappings.rows.map(row => `${row.account_key}:${row.model_code}`));
      assertSetEqual('routing_groups', expected('routing_group').map(record => record.value.groupKey), groups.rows.map(row => row.group_key));
      assertSetEqual('routing_group_accounts', expected('routing_group_account').map(record => `${record.value.groupKey}:${record.value.accountKey}`), members.rows.map(row => `${row.group_key}:${row.account_key}`));
      assertSetEqual('routing_group_models', expected('routing_group_model').map(record => `${record.value.groupKey}:${record.value.modelCode}`), groupModels.rows.map(row => `${row.group_key}:${row.model_code}`));
      assertSetEqual('payment_providers', expected('payment_provider').map(record => record.value.providerCode), payments.rows.map(row => row.provider_code));
      const modelByCode = new Map(models.rows.map(row => [row.model_code, row]));
      for (const record of expected('model')) {
        const row = modelByCode.get(record.value.modelCode);
        for (const [field, column] of [
          ['contextLength', 'context_length'], ['sortOrder', 'sort_order'], ['officialProvider', 'official_provider'],
          ['officialCurrency', 'official_currency'], ['officialInputPrice', 'official_input_price'],
          ['officialOutputPrice', 'official_output_price'], ['officialCachedInputPrice', 'official_cached_input_price'],
          ['officialUnitTokens', 'official_unit_tokens'],
        ]) assertImportedValue(`models.${record.value.modelCode}.${column}`, record.value[field], row?.[column]);
        assertImportedJson(`models.${record.value.modelCode}.capabilities`, record.value.capabilities, row?.capabilities);
        assertImportedTimestamp(`models.${record.value.modelCode}.official_price_updated_at`, record.value.officialPriceUpdatedAt, row?.official_price_updated_at);
      }
      const accountByKey = new Map(accounts.rows.map(row => [row.account_key, row]));
      for (const record of expected('upstream_account')) {
        const row = accountByKey.get(record.value.accountKey);
        for (const [field, column] of [
          ['maxConcurrency', 'max_concurrency'], ['rpmLimit', 'rpm_limit'], ['tpmLimit', 'tpm_limit'],
          ['cooldownSeconds', 'cooldown_seconds'], ['priority', 'priority'], ['weight', 'weight'],
        ]) assertImportedValue(`upstream_accounts.${record.value.accountKey}.${column}`, record.value[field], row?.[column]);
      }
      const mappingByKey = new Map(mappings.rows.map(row => [`${row.account_key}:${row.model_code}`, row]));
      for (const record of expected('account_model')) {
        const key = `${record.value.accountKey}:${record.value.modelCode}`;
        const row = mappingByKey.get(key);
        assertImportedValue(`account_models.${key}.upstream_model_name`, record.value.upstreamModelName, row?.upstream_model_name);
        assertImportedValue(`account_models.${key}.supports_image_input`, record.value.supportsImageInput, row?.supports_image_input);
        assertImportedValue(`account_models.${key}.status`, record.value.status, row?.status);
      }
      const fallbackByGroup = new Map(expected('routing_group_fallback')
        .map(record => [record.value.groupKey, record.value.fallbackGroupKey]));
      const groupByKey = new Map(groups.rows.map(row => [row.group_key, row]));
      for (const record of expected('routing_group')) {
        const row = groupByKey.get(record.value.groupKey);
        assertImportedValue(`routing_groups.${record.value.groupKey}.fallback_group_key`, fallbackByGroup.get(record.value.groupKey) || null, row?.fallback_group_key);
        assertImportedValue(`routing_groups.${record.value.groupKey}.description`, record.value.description, row?.description);
        assertImportedValue(`routing_groups.${record.value.groupKey}.restrict_models`, record.value.restrictModels, row?.restrict_models);
        assertImportedValue(`routing_groups.${record.value.groupKey}.billing_multiplier_input`, record.value.billingMultiplierInput, row?.billing_multiplier_input);
        assertImportedValue(`routing_groups.${record.value.groupKey}.billing_multiplier_output`, record.value.billingMultiplierOutput, row?.billing_multiplier_output);
        assertImportedValue(`routing_groups.${record.value.groupKey}.billing_multiplier_image`, record.value.billingMultiplierImage, row?.billing_multiplier_image);
      }
      const memberByKey = new Map(members.rows.map(row => [`${row.group_key}:${row.account_key}`, row]));
      for (const record of expected('routing_group_account')) {
        const key = `${record.value.groupKey}:${record.value.accountKey}`;
        const row = memberByKey.get(key);
        assertImportedValue(`routing_group_accounts.${key}.priority`, record.value.priority, row?.priority);
        assertImportedValue(`routing_group_accounts.${key}.weight`, record.value.weight, row?.weight);
        assertImportedValue(`routing_group_accounts.${key}.status`, record.value.status, row?.status);
      }
      const groupModelByKey = new Map(groupModels.rows.map(row => [`${row.group_key}:${row.model_code}`, row]));
      for (const record of expected('routing_group_model')) {
        const key = `${record.value.groupKey}:${record.value.modelCode}`;
        const row = groupModelByKey.get(key);
        assertImportedValue(`routing_group_models.${key}.status`, record.value.status, row?.status);
        for (const [field, column] of [
          ['billingMultiplier', 'billing_multiplier'], ['billingMultiplierInput', 'billing_multiplier_input'],
          ['billingMultiplierOutput', 'billing_multiplier_output'], ['billingMultiplierImage', 'billing_multiplier_image'],
        ]) assertImportedValue(`routing_group_models.${key}.${column}`, record.value[field], row?.[column]);
      }
      const configByKey = new Map(configs.rows.map(row => [row.config_key, row.config_value]));
      for (const record of expected('system_config')) {
        if (!configByKey.has(record.value.configKey)) throw new Error(`system_config 缺少 ${record.value.configKey}`);
      }
      if (configByKey.get('payment_enabled') !== false && configByKey.get('payment_enabled') !== 'false') {
        throw new Error('控制面导入核对失败: payment_enabled 必须为 false');
      }
      const counts = userPlane.rows[0] || {};
      for (const [table, count] of Object.entries(counts)) {
        if (Number(count) !== 0) throw new Error(`控制面导入核对失败: 用户面表 ${table} 不是空表`);
      }
      if (!secretBox?.open) throw new Error('控制面导入核对需要密钥盒解封能力');
      for (const row of accounts.rows) {
        const plaintext = secretBox.open(row.api_key_envelope, { aad: `upstream_accounts:${row.account_key}` });
        if (!plaintext) throw new Error(`上游账号 ${row.account_key} 的密文无法核对`);
      }
      for (const row of payments.rows) {
        if (row.status !== 'disabled') throw new Error(`支付服务商 ${row.provider_code} 导入后必须禁用`);
        if (row.secret_envelope) {
          const plaintext = secretBox.open(row.secret_envelope, { aad: `payment_providers:${row.provider_code}` });
          if (!plaintext) throw new Error(`支付服务商 ${row.provider_code} 的密文无法核对`);
        }
      }
      return {
        staff_users: staff.rows.length,
        models: models.rows.length,
        pricing_rules: prices.rows.length,
        system_config: configs.rows.length,
        imported_system_config: expected('system_config').length,
        upstream_accounts: accounts.rows.length,
        account_models: mappings.rows.length,
        routing_groups: groups.rows.length,
        routing_group_accounts: members.rows.length,
        routing_group_models: groupModels.rows.length,
        payment_providers: payments.rows.length,
        user_plane_zero: true,
        secrets_opened: accounts.rows.length + payments.rows.filter(row => row.secret_envelope).length,
      };
    },
  };
}

module.exports = {
  EXCLUDED_USER_PLANE_TABLES,
  buildControlPlaneImportPlan,
  createPostgresControlPlaneSink,
  executeControlPlaneImport,
  legacyControlPlaneSnapshot,
  loadSqlJsControlPlaneSnapshot,
};
