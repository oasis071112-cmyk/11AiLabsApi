class BackgroundWorker {
  constructor({
    tasks = [],
    intervalMs = 30_000,
    clock = () => new Date(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    logger = console,
  } = {}) {
    this.tasks = tasks;
    this.intervalMs = intervalMs;
    this.clock = clock;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.logger = logger;
    this.timer = null;
    this.running = null;
    this.lastResult = null;
    this.taskLastRuns = new Map();
  }

  async runCycle() {
    if (this.running) return this.running;
    this.running = (async () => {
      const startedAt = this.clock();
      const results = [];
      for (const task of this.tasks) {
        const nowMs = this.clock().getTime();
        const lastRun = this.taskLastRuns.get(task.name);
        if (lastRun === undefined && task.runOnStart === false) {
          this.taskLastRuns.set(task.name, nowMs);
          results.push({ name: task.name, status: 'skipped', reason: 'initial_delay' });
          continue;
        }
        if (lastRun !== undefined && Number(task.intervalMs || 0) > 0
            && nowMs - lastRun < Number(task.intervalMs)) {
          results.push({ name: task.name, status: 'skipped', reason: 'not_due' });
          continue;
        }
        this.taskLastRuns.set(task.name, nowMs);
        const taskStartedAt = Date.now();
        try {
          const detail = await task.run();
          results.push({ name: task.name, status: 'ok', duration_ms: Date.now() - taskStartedAt, detail });
        } catch (error) {
          results.push({ name: task.name, status: 'error', duration_ms: Date.now() - taskStartedAt, error: error.message });
          this.logger.error?.(`[worker:${task.name}] ${error.message}`);
        }
      }
      this.lastResult = {
        status: results.some(task => task.status === 'error') ? 'degraded' : 'ok',
        started_at: startedAt.toISOString(),
        finished_at: this.clock().toISOString(),
        tasks: results,
      };
      return this.lastResult;
    })();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  async start() {
    if (this.timer) return this.lastResult;
    const result = await this.runCycle();
    if (!this.timer) {
      this.timer = this.setIntervalFn(() => {
        this.runCycle().catch(error => this.logger.error?.(`[worker] ${error.message}`));
      }, this.intervalMs);
      this.timer?.unref?.();
    }
    return result;
  }

  async stop() {
    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = null;
    if (this.running) await this.running;
  }

  health() {
    return this.lastResult || { status: 'starting', tasks: [] };
  }
}

module.exports = { BackgroundWorker };
