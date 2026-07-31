class RedisSnapshotCache {
  constructor(client, { prefix = 'ionailabs', versionKey = 'control-plane:version' } = {}) {
    if (!client) throw new Error('RedisSnapshotCache client is required');
    this.client = client;
    this.prefix = prefix;
    this.versionKey = `${prefix}:${versionKey}`;
  }

  key(value) {
    return `${this.prefix}:${value}`;
  }

  async get(key) {
    const value = await this.client.get(this.key(key));
    return value ? JSON.parse(value) : null;
  }

  async set(key, value, ttlSeconds = 30) {
    await this.client.set(this.key(key), JSON.stringify(value), { EX: ttlSeconds });
  }

  bumpVersion() {
    return this.client.incr(this.versionKey);
  }
}

module.exports = { RedisSnapshotCache };
