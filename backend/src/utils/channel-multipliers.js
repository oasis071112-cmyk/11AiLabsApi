function positiveMultiplier(value) {
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
}

function resolveChannelMultipliers(channel = {}, fallback = {}) {
  return {
    input: positiveMultiplier(channel?.billing_multiplier_input)
      ?? positiveMultiplier(fallback.input)
      ?? 1,
    output: positiveMultiplier(channel?.billing_multiplier_output)
      ?? positiveMultiplier(fallback.output)
      ?? 1,
    image: positiveMultiplier(channel?.billing_multiplier_image)
      ?? positiveMultiplier(fallback.image)
      ?? 1,
  };
}

const multiplierFields = {
  input: 'billing_multiplier_input',
  output: 'billing_multiplier_output',
  image: 'billing_multiplier_image',
};

function resolveEffectiveMultiplierPolicy({
  userRule = null,
  channel = null,
  platformModelRule = null,
  platformDefaultRule = null,
  model = null,
} = {}) {
  const candidates = [
    ['user', userRule],
    ['channel', channel],
    ['platform_model', platformModelRule],
    ['platform_default', platformDefaultRule],
    ['model_default', model],
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
}) {
  const now = new Date().toISOString();
  const scopeClause = scopeType === 'user' ? 'AND scope_id=?' : '';
  const modelClause = exactModel ? 'model_code=?' : 'model_code IS NULL';
  const params = [scopeType];
  if (scopeType === 'user') params.push(scopeId);
  if (exactModel) params.push(modelCode);
  params.push(now, now);
  return db.prepare(`SELECT * FROM pricing_rules
    WHERE scope_type=? ${scopeClause} AND ${modelClause}
      AND status='active'
      AND (start_time IS NULL OR start_time<=?)
      AND (end_time IS NULL OR end_time>=?)
    ORDER BY priority DESC,id DESC LIMIT 1`).get(...params);
}

function multiplierPolicyContext(db, modelCode, userId) {
  return {
    userRule: activeRule(db, {
      scopeType: 'user', scopeId: userId, modelCode, exactModel: true,
    }) || activeRule(db, {
      scopeType: 'user', scopeId: userId, modelCode, exactModel: false,
    }),
    platformModelRule: activeRule(db, {
      scopeType: 'platform', modelCode, exactModel: true,
    }),
    platformDefaultRule: activeRule(db, {
      scopeType: 'platform', modelCode, exactModel: false,
    }),
  };
}

function resolveModelMultiplierPolicy(db, {
  model,
  userId = null,
  channel = null,
}) {
  return resolveEffectiveMultiplierPolicy({
    ...multiplierPolicyContext(db, model.model_code, userId),
    channel,
    model,
  });
}

module.exports = {
  positiveMultiplier,
  resolveChannelMultipliers,
  resolveEffectiveMultiplierPolicy,
  multiplierPolicyContext,
  resolveModelMultiplierPolicy,
};
