function resolveRedis(redis) {
  if (redis) return redis;
  try {
    return require('redis');
  } catch (error) {
    throw new Error('Redis 驱动未安装；请安装 redis 后再创建客户端');
  }
}

function createRedisClient({ url = process.env.REDIS_URL, redis, onError = () => {}, ...options } = {}) {
  if (!url) throw new Error('必须设置 REDIS_URL');
  const driver = resolveRedis(redis);
  if (typeof driver.createClient !== 'function') throw new Error('Redis 驱动未提供 createClient()');
  // Gateway lease/rate-limit decisions must fail closed while Redis is down.
  // Queuing commands offline could make a public request hang and then execute
  // after recovery with stale scheduling assumptions.
  const client = driver.createClient({ url, disableOfflineQueue: true, ...options });
  // node-redis requires an error listener; without one a transient socket loss
  // becomes an uncaught exception and interrupts its reconnect state machine.
  if (typeof client.on === 'function') client.on('error', onError);
  return client;
}

async function checkRedis(client) {
  const startedAt = Date.now();
  try {
    if (client?.isOpen === false && typeof client.connect === 'function') await client.connect();
    const reply = await client.ping();
    if (reply !== 'PONG') throw new Error('Redis PING 未返回 PONG');
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - startedAt };
  }
}

module.exports = {
  checkRedis,
  createRedisClient,
};
