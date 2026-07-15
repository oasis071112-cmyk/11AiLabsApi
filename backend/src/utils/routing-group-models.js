function listRoutingGroupModels(db, groupId, visitedGroups = new Set()) {
  if (visitedGroups.has(groupId)) return [];
  visitedGroups.add(groupId);
  const group = db.prepare("SELECT restrict_models,fallback_group_id FROM routing_groups WHERE id=? AND status='active'").get(groupId);
  if (!group) return [];
  const whitelistJoin = Number(group.restrict_models) === 1
    ? "JOIN routing_group_models rgm ON rgm.group_id=rgc.group_id AND rgm.model_code=cm.model_code AND rgm.status='active'"
    : '';
  const models = db.prepare(`SELECT DISTINCT m.model_code,m.model_name,m.sort_order
    FROM routing_group_channels rgc
    JOIN upstream_channels uc ON uc.id=rgc.channel_id
    JOIN channel_models cm ON cm.channel_id=uc.id AND cm.status='active'
    JOIN models m ON m.model_code=cm.model_code AND m.status='active'
    ${whitelistJoin}
    WHERE rgc.group_id=? AND rgc.status='active'
    ORDER BY m.sort_order,m.model_code`).all(groupId);
  if (!group.fallback_group_id) return models;
  const fallbackModels = listRoutingGroupModels(db, group.fallback_group_id, visitedGroups);
  const byCode = new Map(models.map(model => [model.model_code, model]));
  for (const model of fallbackModels) if (!byCode.has(model.model_code)) byCode.set(model.model_code, model);
  return [...byCode.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.model_code.localeCompare(b.model_code));
}

function listModelsForApiKey(db, apiKey) {
  if (!apiKey.routing_group_id) {
    return db.prepare(`SELECT DISTINCT m.model_code,m.model_name,m.sort_order
      FROM api_key_permissions permission
      JOIN models m ON m.model_code=permission.model_code AND m.status='active'
      WHERE permission.api_key_id=? AND permission.status='active'
      ORDER BY m.sort_order,m.model_code`).all(apiKey.id);
  }
  const groupModels = listRoutingGroupModels(db, apiKey.routing_group_id);
  if (apiKey.permission_mode === 'group_dynamic') return groupModels;
  const allowed = new Set(db.prepare(`SELECT model_code FROM api_key_permissions
    WHERE api_key_id=? AND status='active'`).all(apiKey.id).map(item => item.model_code));
  return groupModels.filter(model => allowed.has(model.model_code));
}

function apiKeyCanUseModel(db, apiKey, modelCode) {
  return listModelsForApiKey(db, apiKey).some(model => model.model_code === modelCode);
}

module.exports = { listRoutingGroupModels, listModelsForApiKey, apiKeyCanUseModel };
