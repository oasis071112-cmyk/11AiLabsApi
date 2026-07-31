class WorkerHeartbeat {
  constructor({
    redis,
    key,
    intervalMs = 30_000,
    ttlSeconds = 90,
    clock = () => new Date(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    logger = console,
  } = {}) {
    if (!redis?.set) throw new Error('worker heartbeat Redis client is required');
    if (!key) throw new Error('worker heartbeat key is required');
    if (!Number.isInteger(intervalMs) || intervalMs < 1_000) throw new Error('worker heartbeat interval must be at least 1000ms');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds * 1_000 <= intervalMs) {
      throw new Error('worker heartbeat TTL must exceed its interval');
    }
    this.redis = redis;
    this.key = key;
    this.intervalMs = intervalMs;
    this.ttlSeconds = ttlSeconds;
    this.clock = clock;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.logger = logger;
    this.timer = null;
    this.running = null;
  }

  async pulse() {
    if (this.running) return this.running;
    this.running = this.redis.set(this.key, this.clock().toISOString(), { EX: this.ttlSeconds });
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  async start() {
    if (this.timer) return;
    await this.pulse();
    this.timer = this.setIntervalFn(() => {
      this.pulse().catch(error => this.logger.error?.(`[worker:heartbeat] ${error.message}`));
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  async stop() {
    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = null;
    if (this.running) await this.running;
  }
}

module.exports = { WorkerHeartbeat };
