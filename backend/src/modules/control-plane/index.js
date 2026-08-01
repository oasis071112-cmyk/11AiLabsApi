const { randomUUID } = require('node:crypto');

const ACCOUNT_PROTOCOLS = new Set(['openai_compatible', 'anthropic']);
const ACCOUNT_CAPABILITIES = new Set([
  'chat_completions', 'embeddings', 'image_generations', 'image_edits',
  'image_variations', 'image_transformations', 'responses', 'anthropic_messages',
  'anthropic_count_tokens',
]);
const SECRET_FIELDS = new Set([
  'api_key', 'credential_ciphertext', 'credentials_ciphertext', 'encrypted_credentials',
  'merchant_key', 'private_key',
]);

function controlPlaneError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!SECRET_FIELDS.has(key)) result[key] = sanitize(child);
  }
  return result;
}

function integerLimit(value, name, { minimum = 0, fallback = 0 } = {}) {
  const normalized = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum) {
    throw controlPlaneError(`${name}无效`, 'INVALID_ACCOUNT_LIMIT');
  }
  return normalized;
}

function naturalAccountKey(value) {
  const normalized = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `account-${randomUUID()}`;
}

function normalizedAccount(input, secretCipher) {
  const name = String(input.name || input.channel_name || '').trim();
  const baseUrl = String(input.base_url || '').trim().replace(/\/+$/, '');
  const apiKey = String(input.api_key || '').trim();
  const protocolType = String(input.protocol_type || 'openai_compatible').trim();
  if (!name || !baseUrl || !apiKey) {
    throw controlPlaneError('账号名称、上游地址和凭证不能为空', 'INVALID_ACCOUNT');
  }
  if (!/^https?:\/\//i.test(baseUrl)) throw controlPlaneError('上游地址无效', 'INVALID_ACCOUNT');
  if (!ACCOUNT_PROTOCOLS.has(protocolType)) throw controlPlaneError('上游协议无效', 'INVALID_ACCOUNT_PROTOCOL');
  const capabilities = [...new Set(Array.isArray(input.capabilities) ? input.capabilities : [])];
  if (capabilities.some(capability => !ACCOUNT_CAPABILITIES.has(capability))) {
    throw controlPlaneError('包含不支持的接口能力', 'INVALID_ACCOUNT_CAPABILITY');
  }
  const maxConcurrency = integerLimit(input.max_concurrency, '最大并发', { minimum: 1, fallback: 5 });
  const rpmLimit = integerLimit(input.rpm_limit, 'RPM', { minimum: 0, fallback: 0 });
  const tpmLimit = integerLimit(input.tpm_limit, 'TPM', { minimum: 0, fallback: 0 });
  const cooldownSeconds = integerLimit(input.cooldown_seconds, '冷却时间', { minimum: 0, fallback: 60 });
  const priority = integerLimit(input.priority, '优先级', { minimum: 0, fallback: 0 });
  const weight = integerLimit(input.weight, '权重', { minimum: 1, fallback: 100 });
  if (!secretCipher?.encrypt) throw controlPlaneError('未配置凭证加密器', 'SECRET_CIPHER_UNAVAILABLE', 503);
  const accountKey = naturalAccountKey(input.account_key || name);
  return {
    account_key: accountKey,
    name,
    base_url: baseUrl,
    credential_ciphertext: secretCipher.encrypt(apiKey, { accountKey }),
    protocol_type: protocolType,
    capabilities,
    max_concurrency: maxConcurrency,
    rpm_limit: rpmLimit,
    tpm_limit: tpmLimit,
    cooldown_seconds: cooldownSeconds,
    priority,
    weight,
    status: input.status === 'inactive' ? 'inactive' : 'active',
  };
}

class ControlPlane {
  constructor({ repository, secretCipher = null, cache = null, clock = () => new Date() } = {}) {
    if (!repository) throw new Error('ControlPlane repository is required');
    this.repository = repository;
    this.secretCipher = secretCipher;
    this.cache = cache;
    this.clock = clock;
  }

  async bootstrap() {
    return sanitize(await this.repository.getBootstrap());
  }

  async bumpConfigVersion() {
    if (!this.cache?.bumpVersion) return { configVersion: null, cacheStatus: 'disabled' };
    try {
      return { configVersion: await this.cache.bumpVersion(), cacheStatus: 'ok' };
    } catch (_error) {
      return { configVersion: null, cacheStatus: 'degraded' };
    }
  }

  async createAccount(input, actor = {}) {
    const account = normalizedAccount(input || {}, this.secretCipher);
    const created = await this.repository.transaction(async tx => {
      const value = await tx.createAccount(account);
      if (tx.appendAudit) {
        await tx.appendAudit({
          actor_id: actor.id || null,
          actor_role: actor.role || null,
          action: 'upstream_account.create',
          target_type: 'upstream_account',
          target_id: value.id,
          metadata: { name: account.name, protocol_type: account.protocol_type },
          created_at: this.clock().toISOString(),
        });
      }
      return value;
    });
    const cache = await this.bumpConfigVersion();
    return {
      account: sanitize({ ...created, secret_configured: true }),
      config_version: cache.configVersion,
      cache_status: cache.cacheStatus,
    };
  }
}

module.exports = {
  ACCOUNT_CAPABILITIES,
  ACCOUNT_PROTOCOLS,
  ControlPlane,
  controlPlaneError,
  sanitizeControlPlane: sanitize,
};
