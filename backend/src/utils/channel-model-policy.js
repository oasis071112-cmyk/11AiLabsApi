const { resolveModelMultiplierPolicy } = require('./channel-multipliers');

function reconcileModelStatus(db, modelCode) {
  const active = db.prepare(`SELECT 1 FROM channel_models
    WHERE model_code=? AND status='active' LIMIT 1`).get(modelCode);
  const status = active ? 'active' : 'inactive';
  db.prepare(`UPDATE models SET status=?,updated_at=CURRENT_TIMESTAMP
    WHERE model_code=?`).run(status, modelCode);
  return status;
}

function multiplierTuple(db, model, channel) {
  const { multipliers } = resolveModelMultiplierPolicy(db, { model, channel });
  return [multipliers.input, multipliers.output, multipliers.image];
}

function sameTuple(left, right) {
  return left.every((value, index) => Math.abs(value - right[index]) < 1e-12);
}

function routedModelCodesForChannels(db, channelIds) {
  const ids = [...new Set(channelIds.map(Number).filter(Number.isFinite))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT DISTINCT model_code FROM channel_models
    WHERE status='active' AND channel_id IN (${placeholders})`).all(...ids)
    .map(row => row.model_code);
}

function validateActiveRoutingPolicies(db, modelCodes) {
  const codes = Array.isArray(modelCodes)
    ? [...new Set(modelCodes)]
    : db.prepare(`SELECT DISTINCT cm.model_code
      FROM channel_models cm
      JOIN routing_group_channels rgc ON rgc.channel_id=cm.channel_id AND rgc.status='active'
      JOIN routing_groups rg ON rg.id=rgc.group_id AND rg.status='active'
      WHERE cm.status='active'`).all().map(row => row.model_code);
  for (const modelCode of codes) {
    const duplicate = db.prepare(`SELECT rg.group_name,COUNT(DISTINCT cm.channel_id) AS channel_count
      FROM routing_groups rg
      JOIN routing_group_channels rgc ON rgc.group_id=rg.id AND rgc.status='active'
      JOIN upstream_channels uc ON uc.id=rgc.channel_id AND uc.status='active'
      JOIN channel_models cm ON cm.channel_id=uc.id
        AND cm.model_code=? AND cm.status='active'
      WHERE rg.status='active'
      GROUP BY rg.id HAVING COUNT(DISTINCT cm.channel_id)>1 LIMIT 1`).get(modelCode);
    if (duplicate) {
      return {
        status: 409,
        error: `同一路由分组“${duplicate.group_name}”中不能同时启用模型 ${modelCode} 的多个渠道`,
      };
    }

    const model = db.prepare('SELECT * FROM models WHERE model_code=?').get(modelCode);
    if (!model) continue;
    const channels = db.prepare(`SELECT DISTINCT uc.*
      FROM upstream_channels uc
      JOIN channel_models cm ON cm.channel_id=uc.id
        AND cm.model_code=? AND cm.status='active'
      JOIN routing_group_channels rgc ON rgc.channel_id=uc.id AND rgc.status='active'
      JOIN routing_groups rg ON rg.id=rgc.group_id AND rg.status='active'
      WHERE uc.status='active' ORDER BY uc.id`).all(modelCode);
    if (channels.length < 2) continue;
    const expected = multiplierTuple(db, model, channels[0]);
    const mismatch = channels.slice(1).find(channel => (
      !sameTuple(expected, multiplierTuple(db, model, channel))
    ));
    if (mismatch) {
      return {
        status: 409,
        error: `模型 ${modelCode} 在渠道“${channels[0].channel_name}”与“${mismatch.channel_name}”的最终倍率不一致`,
      };
    }
  }
  return null;
}

function validateMappingActivation(db, channelId, modelCode) {
  const model = db.prepare('SELECT * FROM models WHERE model_code=?').get(modelCode);
  if (!model) return { error: '模型不存在', status: 404 };
  const channel = db.prepare("SELECT * FROM upstream_channels WHERE id=? AND status='active'")
    .get(channelId);
  if (!channel) return { error: '渠道不存在或未启用', status: 404 };

  const directConflict = db.prepare(`SELECT rg.group_name,uc.channel_name
    FROM routing_group_channels candidate
    JOIN routing_groups rg ON rg.id=candidate.group_id AND rg.status='active'
    JOIN routing_group_channels sibling ON sibling.group_id=candidate.group_id
      AND sibling.status='active' AND sibling.channel_id<>candidate.channel_id
    JOIN upstream_channels uc ON uc.id=sibling.channel_id AND uc.status='active'
    JOIN channel_models cm ON cm.channel_id=sibling.channel_id
      AND cm.model_code=? AND cm.status='active'
    WHERE candidate.channel_id=? AND candidate.status='active'
    LIMIT 1`).get(modelCode, channelId);
  if (directConflict) {
    return {
      status: 409,
      error: `同一路由分组“${directConflict.group_name}”中，模型 ${modelCode} 已由渠道“${directConflict.channel_name}”启用`,
    };
  }

  const candidateGroups = db.prepare(`SELECT 1
    FROM routing_group_channels rgc
    JOIN routing_groups rg ON rg.id=rgc.group_id AND rg.status='active'
    WHERE rgc.channel_id=? AND rgc.status='active' LIMIT 1`).get(channelId);
  if (!candidateGroups) return null;

  const candidateTuple = multiplierTuple(db, model, channel);
  const otherChannels = db.prepare(`SELECT DISTINCT uc.*
    FROM channel_models cm
    JOIN upstream_channels uc ON uc.id=cm.channel_id AND uc.status='active'
    JOIN routing_group_channels rgc ON rgc.channel_id=uc.id AND rgc.status='active'
    JOIN routing_groups rg ON rg.id=rgc.group_id AND rg.status='active'
    WHERE cm.model_code=? AND cm.status='active' AND cm.channel_id<>?`)
    .all(modelCode, channelId);
  const mismatch = otherChannels.find(other => (
    !sameTuple(candidateTuple, multiplierTuple(db, model, other))
  ));
  if (mismatch) {
    return {
      status: 409,
      error: `模型 ${modelCode} 在渠道“${channel.channel_name}”与“${mismatch.channel_name}”的最终倍率不一致`,
    };
  }
  return null;
}

function setChannelModelStatus(db, channelId, modelCode, status) {
  const mapping = db.prepare(`SELECT id FROM channel_models
    WHERE channel_id=? AND model_code=?`).get(channelId, modelCode);
  if (!mapping) return { error: '渠道模型映射不存在', status: 404 };
  if (status === 'active') {
    const conflict = validateMappingActivation(db, channelId, modelCode);
    if (conflict) return conflict;
  }
  db.prepare(`UPDATE channel_models SET status=?,updated_at=CURRENT_TIMESTAMP
    WHERE channel_id=? AND model_code=?`).run(status, channelId, modelCode);
  const modelStatus = reconcileModelStatus(db, modelCode);
  return { modelStatus };
}

module.exports = {
  reconcileModelStatus,
  routedModelCodesForChannels,
  setChannelModelStatus,
  validateActiveRoutingPolicies,
  validateMappingActivation,
};
