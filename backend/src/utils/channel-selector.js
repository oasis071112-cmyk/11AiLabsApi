/**
 * 上游渠道选择器 — 加权轮询 + 熔断降级 + 健康检查
 */
const axios = require('axios');

// 内置状态（内存中的轮询计数器、熔断状态）
const state = {
  roundRobinIndex: {},  // channel_id -> 当前轮询游标
  initialized: false,
};

/**
 * 加权轮询选择渠道
 * @param {Array} channels - 活跃的渠道列表（已含 health_score 等字段）
 * @param {string} modelCode - 模型编码（预留）
 * @returns {Object|null} 选中的渠道
 */
function weightedRoundRobin(channels, modelCode) {
  if (!channels || channels.length === 0) return null;

  // 过滤：状态 active + 熔断期未过
  const now = new Date().toISOString();
  const available = channels.filter(c => {
    if (c.status !== 'active') return false;
    if (c.circuit_breaker_until && c.circuit_breaker_until > now) return false;
    return true;
  });
  if (available.length === 0) return null;

  // 按 health_score 自动分配（健康分高的分到更多流量）
  const scores = available.map(c => Math.max(1, (c.health_score || 100)));
  const totalScore = scores.reduce((s, v) => s + v, 0);
  let rand = Math.random() * totalScore;
  for (let i = 0; i < available.length; i++) {
    rand -= scores[i];
    if (rand <= 0) return available[i];
  }
  return available[available.length - 1];
}

/**
 * 健康检查：对所有 active 渠道发送心跳
 * @param {Object} db - 数据库实例
 */
async function healthCheck(db) {
  const channels = db.prepare("SELECT * FROM upstream_channels WHERE status='active'").all();
  if (!channels || channels.length === 0) return;

  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      const start = Date.now();
      let ok = false;
      try {
        // 轻量检测：GET 渠道根路径或 /models 端点
        const resp = await axios.get(channel.base_url.replace(/\/+$/, '') + '/models', {
          headers: { 'Authorization': `Bearer ${channel.api_key}`, 'Accept': 'application/json' },
          timeout: 8000,
          validateStatus: s => s < 500,
        });
        ok = resp.status < 500;  // 4xx 也算活跃（只是鉴权问题）
      } catch (e) {
        ok = false;
      }
      const latency = Date.now() - start;
      return { channel, ok, latency };
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { channel, ok, latency } = result.value;
    const now = new Date().toISOString();
    if (ok) {
      // 成功：重置熔断
      const newScore = Math.min(100, (channel.health_score || 100) + 5);
      db.prepare("UPDATE upstream_channels SET health_score=?, failure_count=0, circuit_breaker_until=NULL, consecutive_failures=0, last_check_time=?, total_requests=total_requests+1, total_successes=total_successes+1 WHERE id=?")
        .run(newScore, now, channel.id);
    } else {
      // 失败：递增熔断计数器
      const newFails = (channel.consecutive_failures || 0) + 1;
      const newScore = Math.max(0, (channel.health_score || 100) - 15);
      const cbMinutes = Math.min(30, Math.pow(2, newFails));  // 指数退避: 2min, 4min, 8min, 16min, 32min...
      const breakerUntil = new Date(Date.now() + cbMinutes * 60000).toISOString();
      db.prepare("UPDATE upstream_channels SET health_score=?, consecutive_failures=?, failure_count=failure_count+1, circuit_breaker_until=?, last_check_time=?, total_requests=total_requests+1 WHERE id=?")
        .run(newScore, newFails, breakerUntil, now, channel.id);
    }
  }
}

/**
 * 获取可用渠道（代理层入口）
 * @param {Object} db - 数据库实例
 * @param {string} modelCode - 请求的模型编码
 * @returns {Object|null} 选中的渠道
 */
function selectChannel(db, modelCode) {
  // 先查模型对应的 channel_id
  const model = db.prepare("SELECT channel_id FROM models WHERE model_code=? AND status='active'").get(modelCode);
  if (!model || !model.channel_id) return null;

  // 只查询该渠道下的活跃上游
  const channels = db.prepare("SELECT * FROM upstream_channels WHERE id=? AND status='active'").all(model.channel_id);
  if (!channels || channels.length === 0) return null;

  return weightedRoundRobin(channels, modelCode);
}

/**
 * 上报请求结果（代理层调用）
 * @param {Object} db - 数据库实例
 * @param {number} channelId - 渠道 ID
 * @param {boolean} success - 是否成功
 */
function reportResult(db, channelId, success) {
  if (success) {
    db.prepare("UPDATE upstream_channels SET consecutive_failures=0, health_score=MIN(100,health_score+1) WHERE id=?").run(channelId);
  } else {
    const now = new Date().toISOString();
    // 失败时临时降级该渠道权重（不触发全量熔断）
    db.prepare("UPDATE upstream_channels SET consecutive_failures=consecutive_failures+1, failure_count=failure_count+1, health_score=MAX(0,health_score-10), circuit_breaker_until=? WHERE id=?")
      .run(now, channelId);
  }
}

/**
 * 启动定时健康检查（在 index.js 中调用）
 * @param {Object} db - 数据库实例
 * @param {number} intervalMs - 检查间隔（默认 30 秒）
 */
function startHealthCheck(db, intervalMs = 30000) {
  if (state.initialized) return;
  state.initialized = true;

  // 立即执行一次
  setImmediate(() => healthCheck(db));

  // 定时执行
  setInterval(() => healthCheck(db), intervalMs);

  console.log(`🔍 健康检查已启动 (每 ${intervalMs/1000} 秒)`);
}

module.exports = { selectChannel, reportResult, startHealthCheck, healthCheck };
