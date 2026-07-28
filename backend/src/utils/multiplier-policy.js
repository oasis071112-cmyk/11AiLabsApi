// 用户扣费倍率的单一解析入口：用户 > 路由分组 > 全局 > 1×。
function positiveMultiplier(value) {
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

const multiplierFields = {
  input: 'billing_multiplier_input',
  output: 'billing_multiplier_output',
  image: 'billing_multiplier_image',
};

function resolveEffectiveMultiplierPolicy({
  userRule = null,
  routingGroup = null,
  platformModelRule = null,
  platformDefaultRule = null,
  model = null,
} = {}) {
  const candidates = [
    ['user', userRule],
    ['routing_group', routingGroup],
    ['global', platformModelRule],
    ['global', platformDefaultRule],
    ['global', model],
  ];
  const multipliers = {};
  const sources = {};
  for (const [dimension, field] of Object.entries(multiplierFields)) {
    const match = candidates
      .map(([source, record]) => [source, positiveMultiplier(record?.[field])])
      .find(([, value]) => value !== null);
    multipliers[dimension] = match?.[1] ?? 1;
    sources[dimension] = match?.[0] ?? 'system_default';
  }
  return { multipliers, sources };
}

function activeRule(db, {
  scopeType,
  scopeId = null,
  modelCode,
  exactModel,
  atTime = new Date().toISOString(),
}) {
  const scopeClause = scopeType === 'user' ? 'AND scope_id=?' : '';
  const modelClause = exactModel ? 'model_code=?' : 'model_code IS NULL';
  const params = [scopeType];
  if (scopeType === 'user') params.push(scopeId);
  if (exactModel) params.push(modelCode);
  params.push(atTime, atTime);
  return db.prepare(`SELECT * FROM pricing_rules
    WHERE scope_type=? ${scopeClause} AND ${modelClause}
      AND status='active'
      AND (start_time IS NULL OR datetime(start_time)<=datetime(?))
      AND (end_time IS NULL OR datetime(end_time)>=datetime(?))
    ORDER BY priority DESC,id DESC LIMIT 1`).get(...params);
}

function multiplierPolicyContext(db, modelCode, userId, atTime = new Date().toISOString()) {
  return {
    userRule: activeRule(db, {
      scopeType: 'user', scopeId: userId, modelCode, exactModel: true, atTime,
    }) || activeRule(db, {
      scopeType: 'user', scopeId: userId, modelCode, exactModel: false, atTime,
    }),
    platformModelRule: activeRule(db, {
      scopeType: 'platform', modelCode, exactModel: true, atTime,
    }),
    platformDefaultRule: activeRule(db, {
      scopeType: 'platform', modelCode, exactModel: false, atTime,
    }),
  };
}

function resolveModelMultiplierPolicy(db, {
  model,
  userId = null,
  routingGroup = null,
  routingGroupId = null,
  atTime = new Date().toISOString(),
}) {
  const group = routingGroup || (routingGroupId
    ? db.prepare(`SELECT billing_multiplier_input,billing_multiplier_output,
      billing_multiplier_image FROM routing_groups WHERE id=? AND status='active'`)
      .get(routingGroupId)
    : null);
  return resolveEffectiveMultiplierPolicy({
    ...multiplierPolicyContext(db, model.model_code, userId, atTime),
    routingGroup: group,
    model,
  });
}

module.exports = {
  positiveMultiplier,
  resolveEffectiveMultiplierPolicy,
  multiplierPolicyContext,
  resolveModelMultiplierPolicy,
};
