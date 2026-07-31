function positiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function normalizeLogQuery(query = {}) {
  return {
    page: positiveInteger(query.page, 1, Number.MAX_SAFE_INTEGER),
    limit: positiveInteger(query.limit, 20, 100),
    status: String(query.status || '').trim(),
    model: String(query.model || '').trim(),
    startDate: String(query.start_date || query.startDate || '').trim(),
    endDate: String(query.end_date || query.endDate || '').trim(),
  };
}

function cacheValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_error) { return null; }
  }
  return value;
}

class DashboardReadModel {
  constructor({ repository, cache = null, ttlSeconds = 30, clock = () => new Date() } = {}) {
    if (!repository) throw new Error('DashboardReadModel repository is required');
    this.repository = repository;
    this.cache = cache;
    this.ttlSeconds = ttlSeconds;
    this.clock = clock;
  }

  async readCached(key, loader) {
    let cacheStatus = this.cache ? 'ok' : 'disabled';
    if (this.cache) {
      try {
        const hit = cacheValue(await this.cache.get(key));
        if (hit) return this.decorate(hit, 'cache', cacheStatus);
      } catch (_error) {
        cacheStatus = 'degraded';
      }
    }

    const snapshot = await loader();
    if (this.cache && cacheStatus === 'ok') {
      try {
        await this.cache.set(key, snapshot, this.ttlSeconds);
      } catch (_error) {
        cacheStatus = 'degraded';
      }
    }
    return this.decorate(snapshot, 'database', cacheStatus);
  }

  decorate(snapshot, source, cacheStatus) {
    return {
      ...(snapshot || {}),
      read_model: {
        source,
        cache_status: cacheStatus,
        generated_at: this.clock().toISOString(),
      },
    };
  }

  userBootstrap(userId) {
    return this.readCached(
      `dashboard:user:${userId}`,
      () => this.repository.getUserDashboardSnapshot(userId),
    );
  }

  adminBootstrap() {
    return this.readCached('dashboard:admin', () => this.repository.getAdminDashboardSnapshot());
  }

  userLogsOverview(userId, query = {}) {
    return this.repository.getUserLogsOverview(userId, normalizeLogQuery(query));
  }
}

module.exports = { DashboardReadModel, normalizeLogQuery };
