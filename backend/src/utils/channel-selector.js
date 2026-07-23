/**
 * 上游渠道选择器 — 加权轮询 + 熔断降级 + 健康检查
 */
const axios = require('axios');
const { channelModelSupportsImageInput, channelSupportsCapability } = require('./channel-capabilities');

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
    if (Number(c.health_score ?? 100) <= 0) return false;
    if (Number(c.routing_weight ?? 100) <= 0) return false;
    return true;
  });
  if (available.length === 0) return null;

  // 先使用最高优先级，再按管理员权重与实时健康分共同分配流量。
  const preferredPriority = Math.min(...available.map(c => Number(c.routing_priority || 0)));
  const preferred = available.filter(c => Number(c.routing_priority || 0) === preferredPriority);
  const scores = preferred.map(c =>
    Number(c.health_score ?? 100) * Number(c.routing_weight ?? 100)
  );
  const totalScore = scores.reduce((s, v) => s + v, 0);
  let rand = Math.random() * totalScore;
  for (let i = 0; i < preferred.length; i++) {
    rand -= scores[i];
    if (rand <= 0) return preferred[i];
  }
  return preferred[preferred.length - 1];
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
function selectChannel(db, modelCode, routingGroupId = null, visitedGroups = new Set(), excludedChannelIds = new Set(), requirements = {}) {
  if (routingGroupId) {
    if (visitedGroups.has(routingGroupId)) return null;
    visitedGroups.add(routingGroupId);

    const group = db.prepare(`
      SELECT id,fallback_group_id,restrict_models FROM routing_groups WHERE id=? AND status='active'
    `).get(routingGroupId);
    if (!group) return null;

    if (Number(group.restrict_models) === 1) {
      const allowed = db.prepare("SELECT id FROM routing_group_models WHERE group_id=? AND model_code=? AND status='active'")
        .get(routingGroupId, modelCode);
      if (!allowed) {
        return group.fallback_group_id
          ? selectChannel(db, modelCode, group.fallback_group_id, visitedGroups, excludedChannelIds, requirements)
          : null;
      }
    }

    const channels = db.prepare(`
      SELECT c.*,cm.upstream_model_name,cm.supports_image_input,m.is_multimodal,
             rgc.priority AS routing_priority,rgc.weight AS routing_weight
      FROM routing_group_channels rgc
      JOIN upstream_channels c ON c.id=rgc.channel_id
      JOIN channel_models cm ON cm.channel_id=c.id
      JOIN models m ON m.model_code=cm.model_code
      WHERE rgc.group_id=? AND rgc.status='active'
        AND c.status='active' AND cm.status='active'
        AND m.status='active' AND cm.model_code=?
    `).all(routingGroupId, modelCode);
    const eligible = channels.filter(channel => {
      if (excludedChannelIds.has(channel.id)) return false;
      if (requirements.endpointCapability && !channelSupportsCapability(channel, requirements.endpointCapability)) return false;
      if (requirements.requiresImageInput && !channelModelSupportsImageInput(channel)) return false;
      if (requirements.requiredMappedModelCode) {
        const mapping = db.prepare("SELECT id FROM channel_models WHERE channel_id=? AND model_code=? AND status='active'")
          .get(channel.id, requirements.requiredMappedModelCode);
        if (!mapping) return false;
      }
      return true;
    });
    const selected = weightedRoundRobin(eligible, modelCode);
    if (selected) return selected;
    return group.fallback_group_id
      ? selectChannel(db, modelCode, group.fallback_group_id, visitedGroups, excludedChannelIds, requirements)
      : null;
  }

  // 尚未迁移的调用方继续使用旧模型绑定，避免升级瞬间中断。
  const model = db.prepare("SELECT channel_id,upstream_model_name,is_multimodal FROM models WHERE model_code=? AND status='active'").get(modelCode);
  if (!model || !model.channel_id) return null;
  const channels = db.prepare("SELECT *,? AS upstream_model_name FROM upstream_channels WHERE id=? AND status='active'")
    .all(model.upstream_model_name || modelCode, model.channel_id);
  const eligible = channels.filter(channel => {
    if (excludedChannelIds.has(channel.id)) return false;
    if (requirements.endpointCapability && !channelSupportsCapability(channel, requirements.endpointCapability)) return false;
    if (requirements.requiresImageInput && !channelModelSupportsImageInput({ ...channel, is_multimodal: model.is_multimodal })) return false;
    if (requirements.requiredMappedModelCode) {
      const mapping = db.prepare("SELECT id FROM channel_models WHERE channel_id=? AND model_code=? AND status='active'")
        .get(channel.id, requirements.requiredMappedModelCode);
      if (!mapping) return false;
    }
    return true;
  });
  return weightedRoundRobin(eligible, modelCode);
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
    const channel = db.prepare('SELECT consecutive_failures FROM upstream_channels WHERE id=?').get(channelId);
    const failures = Number(channel?.consecutive_failures || 0) + 1;
    const breakerMinutes = Math.min(30, Math.pow(2, failures));
    const breakerUntil = new Date(Date.now() + breakerMinutes * 60_000).toISOString();
    // 失败后进入指数退避熔断，避免下一请求立即再次命中同一故障渠道。
    db.prepare("UPDATE upstream_channels SET consecutive_failures=consecutive_failures+1, failure_count=failure_count+1, health_score=MAX(0,health_score-10), circuit_breaker_until=? WHERE id=?")
      .run(breakerUntil, channelId);
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
