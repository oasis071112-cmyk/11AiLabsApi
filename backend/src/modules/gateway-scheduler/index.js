const { randomUUID } = require('crypto');
const { PostgresAccountRepository } = require('./postgres-account-repository');

const IMAGE_INPUT_CAPABILITIES = new Set(['image_edits', 'image_variations', 'image_transformations']);
const DEFAULT_REDIS_KEY_PREFIX = 'ionailabs';

const ACQUIRE_SCRIPT = `
-- gateway:scheduler:acquire:v1
local now = tonumber(ARGV[1])
local lease_ttl = tonumber(ARGV[2])
local max_concurrency = tonumber(ARGV[3])
local rpm_limit = tonumber(ARGV[4])
local tpm_limit = tonumber(ARGV[5])
local estimated_tokens = tonumber(ARGV[6])
local lease_id = ARGV[7]
local window_ttl = tonumber(ARGV[8])

local cooldown_ttl = redis.call('PTTL', KEYS[4])
if cooldown_ttl == -1 or cooldown_ttl > 0 then
  return {0, 'cooldown', cooldown_ttl}
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local concurrency = redis.call('ZCARD', KEYS[1])
if max_concurrency > 0 and concurrency >= max_concurrency then
  return {0, 'concurrency', 0}
end

local rpm = tonumber(redis.call('GET', KEYS[2]) or '0')
if rpm_limit > 0 and rpm + 1 > rpm_limit then
  return {0, 'rpm', redis.call('PTTL', KEYS[2])}
end

local tpm = tonumber(redis.call('GET', KEYS[3]) or '0')
if tpm_limit > 0 and tpm + estimated_tokens > tpm_limit then
  return {0, 'tpm', redis.call('PTTL', KEYS[3])}
end

local expires_at = now + lease_ttl
redis.call('ZADD', KEYS[1], expires_at, lease_id)
redis.call('PEXPIRE', KEYS[1], lease_ttl * 2)

local rpm_after = redis.call('INCR', KEYS[2])
if rpm_after == 1 then redis.call('PEXPIRE', KEYS[2], window_ttl) end

if estimated_tokens > 0 then
  local tpm_after = redis.call('INCRBY', KEYS[3], estimated_tokens)
  if tpm_after == estimated_tokens then redis.call('PEXPIRE', KEYS[3], window_ttl) end
end

return {1, 'acquired', expires_at}
`;

const RELEASE_SCRIPT = `
-- gateway:scheduler:release:v1
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

const EXTEND_COOLDOWN_SCRIPT = `
-- gateway:scheduler:cooldown:v1
local requested_ttl = tonumber(ARGV[1])
local current_ttl = redis.call('PTTL', KEYS[1])

if current_ttl == -1 or current_ttl >= requested_ttl then
  return {0, current_ttl}
end

redis.call('SET', KEYS[1], ARGV[2], 'PX', requested_ttl)
return {1, requested_ttl}
`;

class GatewaySchedulerError extends Error {
  constructor(code, message, { status = 503, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GatewaySchedulerError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asString(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function normalizeRedisKeyPrefix(redisKeyPrefix = DEFAULT_REDIS_KEY_PREFIX) {
  const prefix = String(redisKeyPrefix).trim().replace(/:+$/, '');
  if (!prefix || /[{}]/.test(prefix)) {
    throw new TypeError('redisKeyPrefix must be non-empty and cannot contain Redis hash-tag braces');
  }
  return prefix;
}

function redisAccountKey(redisKeyPrefix, accountId) {
  if (accountId === null || accountId === undefined || String(accountId) === '') {
    throw new TypeError('accountId is required');
  }
  const accountHashTag = encodeURIComponent(String(accountId));
  return `${normalizeRedisKeyPrefix(redisKeyPrefix)}:gateway:account:{${accountHashTag}}`;
}

async function extendRedisCooldown(redis, {
  accountId,
  cooldownMs,
  metadata = {},
  redisKeyPrefix = DEFAULT_REDIS_KEY_PREFIX,
}) {
  if (!redis || typeof redis.eval !== 'function') throw new TypeError('redis.eval is required');
  const requestedTtl = Math.floor(asNumber(cooldownMs));
  if (requestedTtl <= 0) throw new TypeError('cooldownMs must be a positive number');
  const result = await redis.eval(
    EXTEND_COOLDOWN_SCRIPT,
    {
      keys: [`${redisAccountKey(redisKeyPrefix, accountId)}:cooldown`],
      arguments: [String(requestedTtl), JSON.stringify(metadata)],
    },
  );
  return asNumber(result?.[0]) === 1;
}

function activeMapping(account, model) {
  return (account.modelMappings || []).find(mapping =>
    mapping.model === model && mapping.status !== 'inactive'
  );
}

function includesGroup(account, groupId) {
  if (!groupId || !Array.isArray(account.groupIds)) return true;
  return account.groupIds.some(candidate => String(candidate) === String(groupId));
}

function isEligible(account, request, now) {
  if (!account || account.status !== 'active') return false;
  if ((request.excludedAccountIds || []).some(id => String(id) === String(account.id))) return false;
  if (request.protocol && account.protocol !== request.protocol) return false;
  if (request.capability && !(account.capabilities || []).includes(request.capability)) return false;
  if (!includesGroup(account, request.groupId)) return false;
  if (account.cooldownUntil && new Date(account.cooldownUntil).getTime() > now) return false;
  const mapping = activeMapping(account, request.model);
  if (!mapping) return false;
  if (IMAGE_INPUT_CAPABILITIES.has(request.capability) && !mapping.supportsImageInput) return false;
  return true;
}

function upstreamStatus(error) {
  return asNumber(error?.status ?? error?.statusCode ?? error?.response?.status, 0);
}

function isRetryableUpstreamFailure(error) {
  if (error?.retryable === false) return false;
  if (error?.retryable === true) return true;
  const status = upstreamStatus(error);
  if (status === 408 || status === 429 || status >= 500) return true;
  return ['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']
    .includes(String(error?.code || '').toUpperCase());
}

function orderedByPriorityAndWeight(accounts, random) {
  const priorities = [...new Set(accounts.map(account => asNumber(account.priority)))].sort((a, b) => a - b);
  const ordered = [];
  for (const priority of priorities) {
    const remaining = accounts.filter(account => asNumber(account.priority) === priority);
    while (remaining.length > 0) {
      const scores = remaining.map(account =>
        Math.max(0, asNumber(account.weight, 100)) * Math.max(0, asNumber(account.healthScore, 100))
      );
      const total = scores.reduce((sum, score) => sum + score, 0);
      let index = 0;
      if (total > 0) {
        let cursor = random() * total;
        index = scores.findIndex(score => ((cursor -= score) <= 0));
        if (index < 0) index = remaining.length - 1;
      }
      ordered.push(remaining.splice(index, 1)[0]);
    }
  }
  return ordered;
}

class RedisLeaseStore {
  constructor(redis, {
    leaseTtlMs = 120_000,
    rateWindowMs = 60_000,
    redisKeyPrefix = DEFAULT_REDIS_KEY_PREFIX,
  } = {}) {
    if (!redis || typeof redis.eval !== 'function') throw new TypeError('redis.eval is required');
    this.redis = redis;
    this.leaseTtlMs = leaseTtlMs;
    this.rateWindowMs = rateWindowMs;
    this.redisKeyPrefix = normalizeRedisKeyPrefix(redisKeyPrefix);
  }

  async acquire(account, leaseId, estimatedTokens, now) {
    const accountKey = redisAccountKey(this.redisKeyPrefix, account.id);
    const window = Math.floor(now / this.rateWindowMs);
    let result;
    try {
      result = await this.redis.eval(
        ACQUIRE_SCRIPT,
        {
          keys: [
            `${accountKey}:leases`,
            `${accountKey}:rpm:${window}`,
            `${accountKey}:tpm:${window}`,
            `${accountKey}:cooldown`,
          ],
          arguments: [
            now,
            this.leaseTtlMs,
            asNumber(account.maxConcurrency),
            asNumber(account.rpmLimit),
            asNumber(account.tpmLimit),
            Math.max(0, asNumber(estimatedTokens)),
            leaseId,
            this.rateWindowMs + 1_000,
          ].map(String),
        },
      );
    } catch (error) {
      throw new GatewaySchedulerError(
        'redis_unavailable',
        'Gateway scheduler Redis is unavailable',
        { cause: error },
      );
    }
    return {
      acquired: asNumber(result?.[0]) === 1,
      reason: asString(result?.[1] ?? 'unknown'),
      value: asNumber(result?.[2]),
    };
  }

  async release({ accountId, id }) {
    let removed;
    try {
      removed = await this.redis.eval(
        RELEASE_SCRIPT,
        {
          keys: [`${redisAccountKey(this.redisKeyPrefix, accountId)}:leases`],
          arguments: [String(id)],
        },
      );
    } catch (error) {
      throw new GatewaySchedulerError(
        'redis_unavailable',
        'Gateway scheduler Redis is unavailable',
        { cause: error },
      );
    }
    return asNumber(removed) === 1;
  }

  async setCooldown(accountId, cooldownMs, metadata) {
    try {
      return await extendRedisCooldown(this.redis, {
        accountId,
        cooldownMs,
        metadata,
        redisKeyPrefix: this.redisKeyPrefix,
      });
    } catch (error) {
      throw new GatewaySchedulerError(
        'redis_unavailable',
        'Gateway scheduler Redis is unavailable',
        { cause: error },
      );
    }
  }
}

class GatewayScheduler {
  constructor({
    accountRepository,
    redis,
    now = Date.now,
    idFactory = randomUUID,
    random = Math.random,
    leaseTtlMs,
    rateWindowMs,
    redisKeyPrefix = DEFAULT_REDIS_KEY_PREFIX,
    defaultCooldownMs = 30_000,
    maxCooldownMs = 300_000,
  }) {
    if (!accountRepository || typeof accountRepository.listCandidates !== 'function') {
      throw new TypeError('accountRepository.listCandidates is required');
    }
    this.accountRepository = accountRepository;
    this.leaseStore = new RedisLeaseStore(redis, { leaseTtlMs, rateWindowMs, redisKeyPrefix });
    this.now = now;
    this.idFactory = idFactory;
    this.random = random;
    this.defaultCooldownMs = defaultCooldownMs;
    this.maxCooldownMs = maxCooldownMs;
  }

  async acquire(request) {
    const now = this.now();
    let routingGroupId = request.groupId ?? null;
    const visitedGroups = new Set();
    let eligibleCount = 0;
    const rejections = [];

    while (true) {
      if (routingGroupId !== null) {
        const groupKey = String(routingGroupId);
        if (visitedGroups.has(groupKey)) {
          throw new GatewaySchedulerError(
            'routing_group_cycle',
            'Routing-group fallback contains a cycle',
            { details: { groupId: routingGroupId, visitedGroups: [...visitedGroups] } },
          );
        }
        visitedGroups.add(groupKey);
      }

      const scopedRequest = { ...request, groupId: routingGroupId };
      const candidates = await this.accountRepository.listCandidates({
        groupId: routingGroupId,
        model: request.model,
        protocol: request.protocol,
        capability: request.capability,
      });
      const eligible = orderedByPriorityAndWeight(
        (candidates || []).filter(account => isEligible(account, scopedRequest, now)),
        this.random,
      );
      eligibleCount += eligible.length;

      for (const account of eligible) {
        const leaseId = this.idFactory();
        const result = await this.leaseStore.acquire(account, leaseId, request.estimatedTokens, now);
        if (!result.acquired) {
          rejections.push({
            accountId: account.id,
            routingGroupId,
            reason: result.reason,
            retryAfterMs: result.value,
          });
          continue;
        }
        const mapping = activeMapping(account, request.model);
        return {
          account,
          upstreamModel: mapping.upstreamModel,
          routingGroupId,
          lease: {
            id: leaseId,
            accountId: account.id,
            acquiredAt: now,
            expiresAt: result.value,
          },
        };
      }

      if (routingGroupId === null || typeof this.accountRepository.getFallbackGroupId !== 'function') break;
      const fallbackGroupId = await this.accountRepository.getFallbackGroupId(routingGroupId);
      if (fallbackGroupId === null || fallbackGroupId === undefined) break;
      routingGroupId = fallbackGroupId;
    }

    if (eligibleCount > 0) {
      throw new GatewaySchedulerError(
        'account_capacity_exhausted',
        'Eligible upstream accounts are temporarily at capacity',
        { details: { rejections } },
      );
    }
    throw new GatewaySchedulerError('no_account_available', 'No eligible upstream account is available');
  }

  async release(lease) {
    return this.leaseStore.release(lease);
  }

  async reportResult(selection, outcome = {}) {
    if (!selection?.lease || !selection?.account?.id) {
      throw new TypeError('selection with account and lease is required');
    }
    const status = asNumber(outcome.status ?? outcome.statusCode, 0);
    const success = outcome.success === undefined ? status > 0 && status < 400 : Boolean(outcome.success);
    const errorCode = String(outcome.errorCode || outcome.code || outcome.type || 'upstream_error');
    const overload = !success && (
      status === 429 || status === 503 || outcome.overloaded === true
      || /overload|rate.?limit/i.test(errorCode)
    );
    const accountCooldownMs = asNumber(selection.account.cooldownSeconds) > 0
      ? asNumber(selection.account.cooldownSeconds) * 1_000
      : this.defaultCooldownMs;
    const requestedCooldown = asNumber(outcome.retryAfterMs, accountCooldownMs);
    const cooldownMs = overload
      ? Math.max(1_000, Math.min(this.maxCooldownMs, requestedCooldown > 0 ? requestedCooldown : this.defaultCooldownMs))
      : 0;
    const cooldownUntil = this.now() + cooldownMs;
    let cooldownApplied = false;
    let released = false;

    try {
      if (overload) {
        cooldownApplied = await this.leaseStore.setCooldown(selection.account.id, cooldownMs, {
          reason: errorCode,
          status,
          cooldownUntil,
        });
        if (typeof this.accountRepository.markCooldown === 'function') {
          await this.accountRepository.markCooldown({
            accountId: selection.account.id,
            cooldownUntil,
            reason: errorCode,
            status,
          });
        }
      }
      if (typeof this.accountRepository.reportHealth === 'function') {
        await this.accountRepository.reportHealth({
          accountId: selection.account.id,
          success,
          status,
          errorCode: success ? null : errorCode,
        });
      }
    } finally {
      released = await this.release(selection.lease);
    }

    return { released, cooldownApplied, cooldownMs, cooldownUntil: overload ? cooldownUntil : null };
  }

  async executeWithFailover(request, invoke) {
    if (typeof invoke !== 'function') throw new TypeError('invoke must be a function');
    const excludedAccountIds = new Set(request.excludedAccountIds || []);
    let attempts = 0;
    let lastUpstreamError = null;

    while (true) {
      let selection;
      try {
        selection = await this.acquire({ ...request, excludedAccountIds: [...excludedAccountIds] });
      } catch (error) {
        if (lastUpstreamError && ['no_account_available', 'account_capacity_exhausted'].includes(error.code)) {
          throw new GatewaySchedulerError(
            'upstream_unavailable',
            'All eligible upstream accounts failed',
            { details: { attempts }, cause: lastUpstreamError },
          );
        }
        throw error;
      }

      attempts += 1;
      let value;
      try {
        value = await invoke(selection);
      } catch (error) {
        if (error instanceof GatewaySchedulerError && error.code === 'redis_unavailable') throw error;
        try {
          await this.reportResult(selection, {
            success: false,
            status: upstreamStatus(error),
            errorCode: error?.code || error?.type || 'upstream_error',
            overloaded: error?.overloaded,
            retryAfterMs: error?.retryAfterMs,
          });
        } catch (postProcessingError) {
          // The upstream error determines billing certainty. Lease cleanup is diagnostic only
          // and must never turn a possibly-executed request into a safe-to-refund Redis failure.
          error.postProcessingError = postProcessingError;
        }
        if (error?.executionUncertain === true || !isRetryableUpstreamFailure(error)) throw error;
        lastUpstreamError = error;
        excludedAccountIds.add(selection.account.id);
        continue;
      }

      let postProcessingError = null;
      try {
        await this.reportResult(selection, {
          success: true,
          status: asNumber(value?.status, 200),
        });
      } catch (error) {
        postProcessingError = error;
      }
      return { value, selection, attempts, postProcessingError };
    }
  }
}

function createGatewayScheduler(options) {
  return new GatewayScheduler(options);
}

module.exports = {
  createGatewayScheduler,
  GatewayScheduler,
  GatewaySchedulerError,
  PostgresAccountRepository,
  extendRedisCooldown,
  isRetryableUpstreamFailure,
};
