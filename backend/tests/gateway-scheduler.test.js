import { describe, expect, it } from 'vitest';
import {
  createGatewayScheduler,
  extendRedisCooldown,
  isRetryableUpstreamFailure,
} from '../src/modules/gateway-scheduler/index.js';

class BehaviorRedis {
  constructor() {
    this.leases = new Map();
    this.counters = new Map();
    this.cooldowns = new Map();
    this.setCalls = [];
    this.evalCalls = [];
  }

  async eval(script, options, ...legacyArgs) {
    const objectProtocol = options && typeof options === 'object' && Array.isArray(options.keys);
    const args = objectProtocol
      ? [...options.keys, ...options.arguments]
      : legacyArgs;
    this.evalCalls.push({ protocol: objectProtocol ? 'object' : 'legacy', options });
    if (script.includes('gateway:scheduler:acquire:v1')) {
      const [leasesKey, rpmKey, tpmKey, cooldownKey, nowValue, leaseTtlValue,
        concurrencyValue, rpmValue, tpmValue, tokensValue, leaseId] = args;
      const now = Number(nowValue);
      const leaseTtl = Number(leaseTtlValue);
      const maxConcurrency = Number(concurrencyValue);
      const rpmLimit = Number(rpmValue);
      const tpmLimit = Number(tpmValue);
      const estimatedTokens = Number(tokensValue);
      const cooldownUntil = this.cooldowns.get(cooldownKey) || 0;
      if (cooldownUntil > now) return [0, 'cooldown', cooldownUntil - now];

      const leases = this.leases.get(leasesKey) || new Map();
      for (const [id, expiresAt] of leases) {
        if (expiresAt <= now) leases.delete(id);
      }
      if (maxConcurrency > 0 && leases.size >= maxConcurrency) return [0, 'concurrency', 0];
      const rpm = this.counters.get(rpmKey) || 0;
      if (rpmLimit > 0 && rpm + 1 > rpmLimit) return [0, 'rpm', 30_000];
      const tpm = this.counters.get(tpmKey) || 0;
      if (tpmLimit > 0 && tpm + estimatedTokens > tpmLimit) return [0, 'tpm', 30_000];

      const expiresAt = now + leaseTtl;
      leases.set(String(leaseId), expiresAt);
      this.leases.set(leasesKey, leases);
      this.counters.set(rpmKey, rpm + 1);
      this.counters.set(tpmKey, tpm + estimatedTokens);
      return [1, 'acquired', expiresAt];
    }
    if (script.includes('gateway:scheduler:release:v1')) {
      const [leasesKey, leaseId] = args;
      return this.leases.get(leasesKey)?.delete(String(leaseId)) ? 1 : 0;
    }
    if (script.includes('gateway:scheduler:cooldown:v1')) {
      const [cooldownKey, durationValue, metadata] = args;
      const durationMs = Number(durationValue);
      const currentExpiry = this.cooldowns.get(cooldownKey);
      let currentTtl = -2;
      if (currentExpiry === Infinity) currentTtl = -1;
      else if (currentExpiry > this.now) currentTtl = currentExpiry - this.now;

      if (currentTtl === -1 || currentTtl >= durationMs) return [0, currentTtl];
      this.cooldowns.set(cooldownKey, this.now + durationMs);
      this.setCalls.push({
        key: cooldownKey,
        value: JSON.parse(metadata),
        mode: 'PX',
        durationMs,
        protocol: objectProtocol ? 'object' : 'legacy',
      });
      return [1, durationMs];
    }
    throw new Error('unexpected Redis script');
  }

  async set(key, value, options, legacyDurationValue) {
    const objectProtocol = options && typeof options === 'object';
    const durationValue = objectProtocol ? options.PX : legacyDurationValue;
    const mode = objectProtocol ? 'PX' : options;
    this.setCalls.push({
      key, value: JSON.parse(value), mode, durationMs: Number(durationValue),
      protocol: objectProtocol ? 'object' : 'legacy',
    });
    if (mode === 'PX') this.cooldowns.set(key, this.now + Number(durationValue));
    return 'OK';
  }
}

function schedulerAccount(overrides = {}) {
  return {
    id: 'account-1',
    status: 'active',
    protocol: 'openai_compatible',
    capabilities: ['chat_completions'],
    groupIds: ['primary'],
    priority: 0,
    weight: 100,
    healthScore: 100,
    maxConcurrency: 2,
    rpmLimit: 60,
    tpmLimit: 10_000,
    modelMappings: [{ model: 'public-model', upstreamModel: 'vendor-model', status: 'active' }],
    ...overrides,
  };
}

describe('GatewayScheduler', () => {
  it('never retries a transport failure after a response stream has started', () => {
    const error = Object.assign(new Error('stream interrupted'), {
      code: 'ECONNRESET', retryable: false, responseStarted: true,
    });
    expect(isRetryableUpstreamFailure(error)).toBe(false);
  });

  it('only leases an account matching model, protocol, capability, and routing group', async () => {
    const accounts = [
      schedulerAccount({ id: 'wrong-protocol', protocol: 'anthropic' }),
      schedulerAccount({ id: 'wrong-capability', capabilities: ['embeddings'] }),
      schedulerAccount({ id: 'wrong-group', groupIds: ['other'] }),
      schedulerAccount({
        id: 'image-input-disabled', capabilities: ['image_edits'],
        modelMappings: [{ model: 'gpt-image-2', upstreamModel: 'vendor-image-disabled', status: 'active', supportsImageInput: false }],
      }),
      schedulerAccount({
        id: 'eligible',
        capabilities: ['image_edits'],
        modelMappings: [{ model: 'gpt-image-2', upstreamModel: 'vendor-image-v2', status: 'active', supportsImageInput: true }],
      }),
    ];
    const accountRepository = {
      async listCandidates() { return accounts; },
      async getFallbackGroupId() { return null; },
    };
    const scheduler = createGatewayScheduler({
      accountRepository,
      redis: new BehaviorRedis(),
      now: () => 1_000,
      idFactory: () => 'lease-1',
      random: () => 0,
    });

    const selection = await scheduler.acquire({
      groupId: 'primary',
      model: 'gpt-image-2',
      protocol: 'openai_compatible',
      capability: 'image_edits',
      estimatedTokens: 25,
    });

    expect(selection.account.id).toBe('eligible');
    expect(selection.upstreamModel).toBe('vendor-image-v2');
    expect(selection.routingGroupId).toBe('primary');
    expect(selection.lease).toMatchObject({ id: 'lease-1', accountId: 'eligible' });
  });

  it('uses one prefixed account hash tag and node-redis object eval for every Redis operation', async () => {
    const redis = new BehaviorRedis();
    redis.now = 2_000;
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() { return [schedulerAccount({ rpmLimit: 0, tpmLimit: 0 })]; },
        async getFallbackGroupId() { return null; },
      },
      redis,
      redisKeyPrefix: 'tenant-a',
      now: () => redis.now,
      idFactory: () => 'redis6-lease',
    });
    const selection = await scheduler.acquire({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    });

    await scheduler.reportResult(selection, { success: false, status: 503 });

    expect(redis.evalCalls.map(call => call.protocol)).toEqual(['object', 'object', 'object']);
    expect(redis.evalCalls[0].options).toEqual({
      keys: [
        'tenant-a:gateway:account:{account-1}:leases',
        'tenant-a:gateway:account:{account-1}:rpm:0',
        'tenant-a:gateway:account:{account-1}:tpm:0',
        'tenant-a:gateway:account:{account-1}:cooldown',
      ],
      arguments: expect.arrayContaining(['redis6-lease']),
    });
    expect(redis.evalCalls[1].options).toMatchObject({
      keys: ['tenant-a:gateway:account:{account-1}:cooldown'],
    });
    expect(redis.evalCalls[2].options).toMatchObject({
      keys: ['tenant-a:gateway:account:{account-1}:leases'],
      arguments: ['redis6-lease'],
    });
  });

  it('only extends cooldown TTL and never shortens 300 seconds to 60 seconds', async () => {
    const redis = new BehaviorRedis();
    redis.now = 10_000;

    await expect(extendRedisCooldown(redis, {
      accountId: 'cooldown-account', cooldownMs: 300_000,
      metadata: { reason: 'first-overload' }, redisKeyPrefix: 'pool',
    })).resolves.toBe(true);
    await expect(extendRedisCooldown(redis, {
      accountId: 'cooldown-account', cooldownMs: 60_000,
      metadata: { reason: 'later-overload' }, redisKeyPrefix: 'pool',
    })).resolves.toBe(false);

    const key = 'pool:gateway:account:{cooldown-account}:cooldown';
    expect(redis.cooldowns.get(key)).toBe(310_000);
    expect(redis.setCalls).toEqual([
      expect.objectContaining({ key, durationMs: 300_000, value: { reason: 'first-overload' } }),
    ]);
    expect(redis.evalCalls.map(call => call.protocol)).toEqual(['object', 'object']);
  });

  it('does not replace a permanent cooldown key', async () => {
    const redis = new BehaviorRedis();
    redis.now = 20_000;
    const key = 'ionailabs:gateway:account:{manual-block}:cooldown';
    redis.cooldowns.set(key, Infinity);

    await expect(extendRedisCooldown(redis, {
      accountId: 'manual-block', cooldownMs: 300_000, metadata: { reason: 'automatic' },
    })).resolves.toBe(false);

    expect(redis.cooldowns.get(key)).toBe(Infinity);
    expect(redis.setCalls).toEqual([]);
  });

  it('matches PostgreSQL BIGINT routing-group ids by their canonical string value', async () => {
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() { return [schedulerAccount({ groupIds: ['3'] })]; },
        async getFallbackGroupId() { return null; },
      },
      redis: new BehaviorRedis(),
      idFactory: () => 'bigint-group-lease',
    });

    await expect(scheduler.acquire({
      groupId: 3, model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    })).resolves.toMatchObject({ account: { id: 'account-1' }, routingGroupId: 3 });
  });

  it('enforces concurrent leases atomically and releases the same lease idempotently', async () => {
    const redis = new BehaviorRedis();
    let leaseSequence = 0;
    const accountRepository = {
      async listCandidates() {
        return [schedulerAccount({ maxConcurrency: 1, rpmLimit: 0, tpmLimit: 0 })];
      },
      async getFallbackGroupId() { return null; },
    };
    const scheduler = createGatewayScheduler({
      accountRepository,
      redis,
      now: () => 5_000,
      idFactory: () => `lease-${++leaseSequence}`,
    });
    const request = {
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    };

    const attempts = await Promise.allSettled([scheduler.acquire(request), scheduler.acquire(request)]);

    expect(attempts.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(attempts.find(result => result.status === 'rejected').reason).toMatchObject({
      code: 'account_capacity_exhausted', status: 503,
    });
    const lease = attempts.find(result => result.status === 'fulfilled').value.lease;
    await expect(scheduler.release(lease)).resolves.toBe(true);
    await expect(scheduler.release(lease)).resolves.toBe(false);
    await expect(scheduler.acquire(request)).resolves.toMatchObject({ account: { id: 'account-1' } });
  });

  it('skips a concurrency-limited account and leases the next eligible account', async () => {
    const redis = new BehaviorRedis();
    let leaseSequence = 0;
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() {
          return [
            schedulerAccount({ id: 'busy', maxConcurrency: 1, rpmLimit: 0, tpmLimit: 0 }),
            schedulerAccount({ id: 'concurrency-spare', maxConcurrency: 2, rpmLimit: 0, tpmLimit: 0 }),
          ];
        },
        async getFallbackGroupId() { return null; },
      },
      redis,
      now: () => 6_000,
      random: () => 0,
      idFactory: () => `concurrency-lease-${++leaseSequence}`,
    });
    const request = {
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    };
    const occupied = await scheduler.acquire(request);

    const next = await scheduler.acquire(request);

    expect(occupied.account.id).toBe('busy');
    expect(next.account.id).toBe('concurrency-spare');
  });

  it('skips an RPM-limited account and leases the next eligible account', async () => {
    const redis = new BehaviorRedis();
    let leaseSequence = 0;
    const accountRepository = {
      async listCandidates() {
        return [
          schedulerAccount({ id: 'rpm-limited', maxConcurrency: 5, rpmLimit: 1, tpmLimit: 0 }),
          schedulerAccount({ id: 'rpm-spare', maxConcurrency: 5, rpmLimit: 10, tpmLimit: 0 }),
        ];
      },
      async getFallbackGroupId() { return null; },
    };
    const scheduler = createGatewayScheduler({
      accountRepository, redis, now: () => 10_000, random: () => 0,
      idFactory: () => `rpm-lease-${++leaseSequence}`,
    });
    const request = {
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 20,
    };
    const first = await scheduler.acquire(request);
    await scheduler.release(first.lease);

    const second = await scheduler.acquire(request);

    expect(first.account.id).toBe('rpm-limited');
    expect(second.account.id).toBe('rpm-spare');
  });

  it('skips a TPM-limited account without consuming the spare account budget first', async () => {
    const redis = new BehaviorRedis();
    let leaseSequence = 0;
    const accountRepository = {
      async listCandidates() {
        return [
          schedulerAccount({ id: 'tpm-limited', maxConcurrency: 5, rpmLimit: 0, tpmLimit: 50 }),
          schedulerAccount({ id: 'tpm-spare', maxConcurrency: 5, rpmLimit: 0, tpmLimit: 500 }),
        ];
      },
      async getFallbackGroupId() { return null; },
    };
    const scheduler = createGatewayScheduler({
      accountRepository, redis, now: () => 20_000, random: () => 0,
      idFactory: () => `tpm-lease-${++leaseSequence}`,
    });
    const request = {
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 30,
    };
    const first = await scheduler.acquire(request);
    await scheduler.release(first.lease);

    const second = await scheduler.acquire(request);

    expect(first.account.id).toBe('tpm-limited');
    expect(second.account.id).toBe('tpm-spare');
  });

  it('reports concurrency, RPM, and TPM rejection reasons when every account is limited', async () => {
    const redis = new BehaviorRedis();
    redis.leases.set('ionailabs:gateway:account:{concurrent}:leases', new Map([['occupied', 99_999]]));
    redis.counters.set('ionailabs:gateway:account:{rpm}:rpm:0', 1);
    redis.counters.set('ionailabs:gateway:account:{tpm}:tpm:0', 50);
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() {
          return [
            schedulerAccount({ id: 'concurrent', maxConcurrency: 1, rpmLimit: 0, tpmLimit: 0 }),
            schedulerAccount({ id: 'rpm', maxConcurrency: 5, rpmLimit: 1, tpmLimit: 0 }),
            schedulerAccount({ id: 'tpm', maxConcurrency: 5, rpmLimit: 0, tpmLimit: 50 }),
          ];
        },
        async getFallbackGroupId() { return null; },
      },
      redis,
      now: () => 7_000,
      random: () => 0,
    });

    await expect(scheduler.acquire({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    })).rejects.toMatchObject({
      code: 'account_capacity_exhausted',
      details: {
        rejections: [
          expect.objectContaining({ accountId: 'concurrent', reason: 'concurrency' }),
          expect.objectContaining({ accountId: 'rpm', reason: 'rpm' }),
          expect.objectContaining({ accountId: 'tpm', reason: 'tpm' }),
        ],
      },
    });
  });

  it('reportResult always releases and cools down a 429 account before the next selection', async () => {
    const redis = new BehaviorRedis();
    redis.now = 30_000;
    const healthReports = [];
    const cooldownReports = [];
    let leaseSequence = 0;
    const accountRepository = {
      async listCandidates() {
        return [
          schedulerAccount({ id: 'overloaded', maxConcurrency: 5, rpmLimit: 0, tpmLimit: 0 }),
          schedulerAccount({ id: 'spare', maxConcurrency: 5, rpmLimit: 0, tpmLimit: 0 }),
        ];
      },
      async getFallbackGroupId() { return null; },
      async reportHealth(report) { healthReports.push(report); },
      async markCooldown(report) { cooldownReports.push(report); },
    };
    const scheduler = createGatewayScheduler({
      accountRepository, redis, now: () => redis.now, random: () => 0,
      idFactory: () => `result-lease-${++leaseSequence}`,
    });
    const request = {
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    };
    const overloaded = await scheduler.acquire(request);

    const report = await scheduler.reportResult(overloaded, {
      success: false, status: 429, retryAfterMs: 45_000, errorCode: 'rate_limit_exceeded',
    });
    const next = await scheduler.acquire(request);

    expect(report).toMatchObject({ released: true, cooldownApplied: true, cooldownMs: 45_000 });
    await expect(scheduler.release(overloaded.lease)).resolves.toBe(false);
    expect(next.account.id).toBe('spare');
    expect(redis.setCalls[0]).toMatchObject({
      key: 'ionailabs:gateway:account:{overloaded}:cooldown', mode: 'PX', durationMs: 45_000,
    });
    expect(healthReports).toEqual([expect.objectContaining({ accountId: 'overloaded', success: false, status: 429 })]);
    expect(cooldownReports).toEqual([expect.objectContaining({
      accountId: 'overloaded', cooldownUntil: 75_000, reason: 'rate_limit_exceeded',
    })]);
  });

  it('releases and records an ordinary upstream 4xx without cooling the account', async () => {
    const redis = new BehaviorRedis();
    redis.now = 35_000;
    const healthReports = [];
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() { return [schedulerAccount({ rpmLimit: 0, tpmLimit: 0 })]; },
        async getFallbackGroupId() { return null; },
        async reportHealth(report) { healthReports.push(report); },
      },
      redis,
      now: () => redis.now,
      idFactory: () => 'client-error-lease',
    });
    const selection = await scheduler.acquire({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    });

    const report = await scheduler.reportResult(selection, { success: false, status: 400 });

    expect(report).toMatchObject({ released: true, cooldownApplied: false, cooldownMs: 0 });
    expect(redis.setCalls).toEqual([]);
    expect(healthReports).toEqual([expect.objectContaining({
      accountId: 'account-1', success: false, status: 400, errorCode: 'upstream_error',
    })]);
  });

  it('uses the account cooldown policy for a 503 when upstream gives no Retry-After', async () => {
    const redis = new BehaviorRedis();
    redis.now = 36_000;
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() {
          return [schedulerAccount({ cooldownSeconds: 45, rpmLimit: 0, tpmLimit: 0 })];
        },
        async getFallbackGroupId() { return null; },
      },
      redis,
      now: () => redis.now,
      idFactory: () => 'configured-cooldown-lease',
    });
    const selection = await scheduler.acquire({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    });

    const report = await scheduler.reportResult(selection, { success: false, status: 503 });

    expect(report).toMatchObject({ cooldownApplied: true, cooldownMs: 45_000 });
  });

  it('fails safely with redis_unavailable when atomic lease acquisition cannot reach Redis', async () => {
    const redisFailure = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    });
    const redis = {
      async eval() { throw redisFailure; },
      async set() { throw redisFailure; },
    };
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() { return [schedulerAccount()]; },
        async getFallbackGroupId() { return null; },
      },
      redis,
    });

    await expect(scheduler.acquire({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    })).rejects.toMatchObject({
      code: 'redis_unavailable',
      status: 503,
      cause: redisFailure,
    });
  });

  it('continues into the routing-group fallback when every primary account is limited', async () => {
    const repositoryCalls = [];
    const accountRepository = {
      async listCandidates(criteria) {
        repositoryCalls.push(criteria.groupId);
        if (criteria.groupId === 'primary') {
          return [schedulerAccount({
            id: 'primary-limited', groupIds: ['primary'], rpmLimit: 0, tpmLimit: 5,
          })];
        }
        return [schedulerAccount({
          id: 'fallback-ready', groupIds: ['fallback'], rpmLimit: 0, tpmLimit: 500,
        })];
      },
      async getFallbackGroupId(groupId) {
        return groupId === 'primary' ? 'fallback' : null;
      },
    };
    const scheduler = createGatewayScheduler({
      accountRepository,
      redis: new BehaviorRedis(),
      now: () => 40_000,
      idFactory: () => 'fallback-lease',
      random: () => 0,
    });

    const selection = await scheduler.acquire({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    });

    expect(selection).toMatchObject({
      account: { id: 'fallback-ready' },
      routingGroupId: 'fallback',
    });
    expect(repositoryCalls).toEqual(['primary', 'fallback']);
  });

  it('continues into the routing-group fallback when the primary group has no eligible account', async () => {
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates({ groupId }) {
          return groupId === 'primary'
            ? [schedulerAccount({ id: 'embeddings-only', capabilities: ['embeddings'] })]
            : [schedulerAccount({ id: 'fallback-chat', groupIds: ['fallback'] })];
        },
        async getFallbackGroupId(groupId) { return groupId === 'primary' ? 'fallback' : null; },
      },
      redis: new BehaviorRedis(),
      random: () => 0,
      idFactory: () => 'eligible-fallback-lease',
    });

    await expect(scheduler.acquire({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    })).resolves.toMatchObject({
      account: { id: 'fallback-chat' },
      routingGroupId: 'fallback',
    });
  });

  it('detects a routing-group fallback cycle instead of recursing forever', async () => {
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() { return []; },
        async getFallbackGroupId(groupId) {
          return groupId === 'group-a' ? 'group-b' : 'group-a';
        },
      },
      redis: new BehaviorRedis(),
    });

    await expect(scheduler.acquire({
      groupId: 'group-a', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    })).rejects.toMatchObject({
      code: 'routing_group_cycle',
      status: 503,
      details: { groupId: 'group-a' },
    });
  });

  it('executeWithFailover cools and releases an overloaded account before trying the next account', async () => {
    const redis = new BehaviorRedis();
    redis.now = 50_000;
    const calls = [];
    let leaseSequence = 0;
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() {
          return [
            schedulerAccount({ id: 'first', rpmLimit: 0, tpmLimit: 0 }),
            schedulerAccount({ id: 'second', rpmLimit: 0, tpmLimit: 0 }),
          ];
        },
        async getFallbackGroupId() { return null; },
        async reportHealth() {},
        async markCooldown() {},
      },
      redis,
      now: () => redis.now,
      random: () => 0,
      idFactory: () => `execute-lease-${++leaseSequence}`,
    });

    const execution = await scheduler.executeWithFailover({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    }, async selection => {
      calls.push(selection.account.id);
      if (selection.account.id === 'first') {
        throw Object.assign(new Error('upstream overloaded'), {
          status: 503, code: 'overloaded', retryAfterMs: 20_000,
        });
      }
      return { status: 200, body: 'ok' };
    });

    expect(calls).toEqual(['first', 'second']);
    expect(execution).toMatchObject({
      value: { status: 200, body: 'ok' },
      selection: { account: { id: 'second' } },
      attempts: 2,
    });
    await expect(scheduler.release({ id: 'execute-lease-1', accountId: 'first' })).resolves.toBe(false);
    expect(redis.setCalls[0]).toMatchObject({
      key: 'ionailabs:gateway:account:{first}:cooldown', durationMs: 20_000,
    });
  });

  it('returns an upstream success with postProcessingError when lease release fails afterwards', async () => {
    const releaseFailure = Object.assign(new Error('Redis connection closed'), { code: 'ECONNRESET' });
    const redis = new BehaviorRedis();
    const baseEval = redis.eval.bind(redis);
    redis.eval = async (script, options, ...legacyArgs) => {
      if (script.includes('gateway:scheduler:release:v1')) throw releaseFailure;
      return baseEval(script, options, ...legacyArgs);
    };
    let invokeCount = 0;
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() { return [schedulerAccount({ rpmLimit: 0, tpmLimit: 0 })]; },
        async getFallbackGroupId() { return null; },
        async reportHealth() {},
      },
      redis,
      idFactory: () => 'post-processing-lease',
    });

    const execution = await scheduler.executeWithFailover({
      groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
      capability: 'chat_completions', estimatedTokens: 10,
    }, async () => {
      invokeCount += 1;
      return { status: 200, body: 'already generated' };
    });

    expect(invokeCount).toBe(1);
    expect(execution).toMatchObject({
      value: { status: 200, body: 'already generated' },
      attempts: 1,
      postProcessingError: { code: 'redis_unavailable', status: 503, cause: releaseFailure },
    });
  });

  it('preserves an execution-uncertain upstream error when lease release also fails', async () => {
    const releaseFailure = Object.assign(new Error('Redis connection closed'), { code: 'ECONNRESET' });
    const redis = new BehaviorRedis();
    const baseEval = redis.eval.bind(redis);
    redis.eval = async (script, options, ...legacyArgs) => {
      if (script.includes('gateway:scheduler:release:v1')) throw releaseFailure;
      return baseEval(script, options, ...legacyArgs);
    };
    const scheduler = createGatewayScheduler({
      accountRepository: {
        async listCandidates() { return [schedulerAccount({ rpmLimit: 0, tpmLimit: 0 })]; },
        async getFallbackGroupId() { return null; },
        async reportHealth() {},
      },
      redis,
      idFactory: () => 'uncertain-release-lease',
    });
    const uncertain = Object.assign(new Error('upstream execution may have completed'), {
      code: 'ETIMEDOUT',
      retryable: false,
      executionUncertain: true,
    });

    let caught;
    try {
      await scheduler.executeWithFailover({
        groupId: 'primary', model: 'public-model', protocol: 'openai_compatible',
        capability: 'chat_completions', estimatedTokens: 10,
      }, async () => { throw uncertain; });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(uncertain);
    expect(caught).toMatchObject({
      executionUncertain: true,
      postProcessingError: { code: 'redis_unavailable', status: 503, cause: releaseFailure },
    });
  });
});
