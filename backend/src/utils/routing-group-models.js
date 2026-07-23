const { channelModelSupportsImageInput, channelSupportsCapability } = require('./channel-capabilities');

function listRoutingGroupModels(db, groupId, visitedGroups = new Set()) {
  if (visitedGroups.has(groupId)) return [];
  visitedGroups.add(groupId);
  const group = db.prepare("SELECT restrict_models,fallback_group_id FROM routing_groups WHERE id=? AND status='active'").get(groupId);
  if (!group) return [];
  const whitelistJoin = Number(group.restrict_models) === 1
    ? "JOIN routing_group_models rgm ON rgm.group_id=rgc.group_id AND rgm.model_code=cm.model_code AND rgm.status='active'"
    : '';
  const rows = db.prepare(`SELECT m.model_code,m.model_name,m.sort_order,m.is_multimodal,
      cm.supports_image_input,uc.capabilities
    FROM routing_group_channels rgc
    JOIN upstream_channels uc ON uc.id=rgc.channel_id
    JOIN channel_models cm ON cm.channel_id=uc.id AND cm.status='active'
    JOIN models m ON m.model_code=cm.model_code AND m.status='active'
    ${whitelistJoin}
    WHERE rgc.group_id=? AND rgc.status='active' AND uc.status='active'
    ORDER BY m.sort_order,m.model_code`).all(groupId);
  const byModel = new Map();
  for (const row of rows) {
    const chatCompletions = channelSupportsCapability(row, 'chat_completions');
    const imageGenerations = channelSupportsCapability(row, 'image_generations');
    const responses = channelSupportsCapability(row, 'responses');
    const existing = byModel.get(row.model_code) || {
      model_code: row.model_code,
      model_name: row.model_name,
      sort_order: row.sort_order,
      capabilities: { chat_completions: false, image_input: false, image_generations: false, responses: false },
    };
    existing.capabilities.chat_completions ||= chatCompletions;
    existing.capabilities.image_input ||= chatCompletions && channelModelSupportsImageInput(row);
    existing.capabilities.image_generations ||= imageGenerations;
    existing.capabilities.responses ||= responses;
    byModel.set(row.model_code, existing);
  }
  const models = [...byModel.values()];
  if (!group.fallback_group_id) return models;
  const fallbackModels = listRoutingGroupModels(db, group.fallback_group_id, visitedGroups);
  const byCode = new Map(models.map(model => [model.model_code, model]));
  for (const model of fallbackModels) {
    const existing = byCode.get(model.model_code);
    if (!existing) byCode.set(model.model_code, model);
    else {
      existing.capabilities.chat_completions ||= model.capabilities.chat_completions;
      existing.capabilities.image_input ||= model.capabilities.image_input;
      existing.capabilities.image_generations ||= model.capabilities.image_generations;
      existing.capabilities.responses ||= model.capabilities.responses;
    }
  }
  return [...byCode.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.model_code.localeCompare(b.model_code));
}

function listModelsForApiKey(db, apiKey) {
  if (!apiKey.routing_group_id) {
    return db.prepare(`SELECT DISTINCT m.model_code,m.model_name,m.sort_order,m.is_multimodal,uc.capabilities
      FROM api_key_permissions permission
      JOIN models m ON m.model_code=permission.model_code AND m.status='active'
      LEFT JOIN upstream_channels uc ON uc.id=m.channel_id AND uc.status='active'
      WHERE permission.api_key_id=? AND permission.status='active'
      ORDER BY m.sort_order,m.model_code`).all(apiKey.id).map(model => ({
        model_code: model.model_code,
        model_name: model.model_name,
        sort_order: model.sort_order,
        capabilities: {
          chat_completions: channelSupportsCapability(model, 'chat_completions'),
          image_input: channelSupportsCapability(model, 'chat_completions') && Number(model.is_multimodal) === 1,
          image_generations: channelSupportsCapability(model, 'image_generations'),
          responses: channelSupportsCapability(model, 'responses'),
        },
      }));
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

function listSystemModelCapabilities(db) {
  const rows = db.prepare(`SELECT cm.model_code,cm.supports_image_input,m.is_multimodal,uc.capabilities
    FROM channel_models cm
    JOIN models m ON m.model_code=cm.model_code AND m.status='active'
    JOIN upstream_channels uc ON uc.id=cm.channel_id AND uc.status='active'
    WHERE cm.status='active'`).all();
  const capabilities = new Map();
  for (const row of rows) {
    const current = capabilities.get(row.model_code) || { chat_completions: false, image_input: false, image_generations: false, responses: false };
    const supportsChat = channelSupportsCapability(row, 'chat_completions');
    current.chat_completions ||= supportsChat;
    current.image_input ||= supportsChat && channelModelSupportsImageInput(row);
    current.image_generations ||= channelSupportsCapability(row, 'image_generations');
    current.responses ||= channelSupportsCapability(row, 'responses');
    capabilities.set(row.model_code, current);
  }
  return capabilities;
}

function listUserModelCapabilities(db, userId) {
  const apiKeys = db.prepare(`SELECT id,routing_group_id,permission_mode FROM api_keys
    WHERE user_id=? AND status='active'`).all(userId);
  const capabilities = new Map();
  for (const apiKey of apiKeys) {
    for (const model of listModelsForApiKey(db, apiKey)) {
      const current = capabilities.get(model.model_code) || { chat_completions: false, image_input: false, image_generations: false, responses: false };
      current.chat_completions ||= Boolean(model.capabilities?.chat_completions);
      current.image_input ||= Boolean(model.capabilities?.image_input);
      current.image_generations ||= Boolean(model.capabilities?.image_generations);
      current.responses ||= Boolean(model.capabilities?.responses);
      capabilities.set(model.model_code, current);
    }
  }
  return capabilities;
}

module.exports = {
  listRoutingGroupModels,
  listModelsForApiKey,
  apiKeyCanUseModel,
  listSystemModelCapabilities,
  listUserModelCapabilities,
};
