const { channelModelSupportsImageInput, channelSupportsCapability } = require('./channel-capabilities');
const { CHANNEL_PROTOCOLS } = require('./channel-protocols');

const IMAGE_INPUT_OPERATION_CAPABILITIES = Object.freeze([
  'image_edits',
  'image_variations',
  'image_transformations',
]);

function imageOperationCapabilities(channelModel) {
  const supportsImageInput = channelModelSupportsImageInput(channelModel);
  return Object.fromEntries(IMAGE_INPUT_OPERATION_CAPABILITIES.map(capability => [
    capability,
    channelSupportsCapability(channelModel, capability) && supportsImageInput,
  ]));
}

function emptyImageOperationCapabilities() {
  return Object.fromEntries(IMAGE_INPUT_OPERATION_CAPABILITIES.map(capability => [capability, false]));
}

function mergeImageOperationCapabilities(target, source = {}) {
  for (const capability of IMAGE_INPUT_OPERATION_CAPABILITIES) {
    target[capability] ||= Boolean(source[capability]);
  }
}

function listRoutingGroupProtocolTypes(db, groupId, visitedGroups = new Set()) {
  if (visitedGroups.has(groupId)) return [];
  visitedGroups.add(groupId);
  const group = db.prepare(`SELECT protocol_type,fallback_group_id
    FROM routing_groups WHERE id=? AND status='active'`).get(groupId);
  if (!group) return [];

  const protocols = new Set(db.prepare(`SELECT DISTINCT uc.protocol_type
    FROM routing_group_channels rgc
    JOIN upstream_channels uc ON uc.id=rgc.channel_id
    WHERE rgc.group_id=? AND rgc.status='active' AND uc.status='active'`)
    .all(groupId)
    .map(item => item.protocol_type)
    .filter(protocol => Object.values(CHANNEL_PROTOCOLS).includes(protocol)));

  if (group.fallback_group_id) {
    for (const protocol of listRoutingGroupProtocolTypes(db, group.fallback_group_id, visitedGroups)) {
      protocols.add(protocol);
    }
  }
  if (protocols.size === 0 && Object.values(CHANNEL_PROTOCOLS).includes(group.protocol_type)) {
    protocols.add(group.protocol_type);
  }
  return [...protocols].sort((a, b) => {
    const rank = protocol => protocol === CHANNEL_PROTOCOLS.OPENAI_COMPATIBLE ? 0 : 1;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

function mergeAvailableModel(existing, incoming) {
  if (!existing) {
    return {
      ...incoming,
      protocol_types: [...new Set(incoming.protocol_types || [])].sort(),
      capabilities: { ...(incoming.capabilities || {}) },
    };
  }
  existing.protocol_types = [...new Set([
    ...(existing.protocol_types || []),
    ...(incoming.protocol_types || []),
  ])].sort();
  existing.capabilities ||= {};
  for (const [capability, supported] of Object.entries(incoming.capabilities || {})) {
    existing.capabilities[capability] ||= Boolean(supported);
  }
  if ('supports_image_input' in existing || 'supports_image_input' in incoming) {
    existing.supports_image_input ||= Boolean(incoming.supports_image_input);
  }
  if ('is_multimodal' in existing || 'is_multimodal' in incoming) {
    existing.is_multimodal ||= Boolean(incoming.is_multimodal);
  }
  return existing;
}

function listRoutingGroupModels(db, groupId, visitedGroups = new Set()) {
  if (visitedGroups.has(groupId)) return [];
  visitedGroups.add(groupId);
  const group = db.prepare("SELECT restrict_models,fallback_group_id FROM routing_groups WHERE id=? AND status='active'").get(groupId);
  if (!group) return [];
  const whitelistJoin = Number(group.restrict_models) === 1
    ? "JOIN routing_group_models rgm ON rgm.group_id=rgc.group_id AND rgm.model_code=cm.model_code AND rgm.status='active'"
    : '';
  const rows = db.prepare(`SELECT m.model_code,m.model_name,m.model_type,m.context_length,
      m.sort_order,m.is_multimodal,
      cm.supports_image_input,uc.capabilities,uc.protocol_type
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
    const supportsImageInput = channelModelSupportsImageInput(row);
    const responses = channelSupportsCapability(row, 'responses');
    const anthropicMessages = channelSupportsCapability(row, 'anthropic_messages');
    const anthropicCountTokens = channelSupportsCapability(row, 'anthropic_count_tokens');
    const imageInput = (chatCompletions || anthropicMessages) && supportsImageInput;
    const candidate = {
      model_code: row.model_code,
      model_name: row.model_name,
      model_type: row.model_type,
      context_length: row.context_length,
      sort_order: row.sort_order,
      is_multimodal: imageInput,
      protocol_types: [row.protocol_type],
      capabilities: {
        chat_completions: chatCompletions,
        anthropic_messages: anthropicMessages,
        anthropic_count_tokens: anthropicCountTokens,
        image_input: imageInput,
        image_generations: imageGenerations,
        ...imageOperationCapabilities(row),
        responses,
      },
    };
    byModel.set(row.model_code, mergeAvailableModel(byModel.get(row.model_code), candidate));
  }
  const models = [...byModel.values()];
  if (!group.fallback_group_id) return models;
  const fallbackModels = listRoutingGroupModels(db, group.fallback_group_id, visitedGroups);
  const byCode = new Map(models.map(model => [model.model_code, model]));
  for (const model of fallbackModels) {
    byCode.set(model.model_code, mergeAvailableModel(byCode.get(model.model_code), model));
  }
  return [...byCode.values()].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.model_code.localeCompare(b.model_code));
}

function listModelsForApiKey(db, apiKey) {
  if (!apiKey.routing_group_id) {
    return db.prepare(`SELECT DISTINCT m.model_code,m.model_name,m.model_type,m.context_length,
      m.sort_order,m.is_multimodal,cm.supports_image_input,uc.capabilities,uc.protocol_type
      FROM api_key_permissions permission
      JOIN models m ON m.model_code=permission.model_code AND m.status='active'
      LEFT JOIN upstream_channels uc ON uc.id=m.channel_id AND uc.status='active'
      LEFT JOIN channel_models cm ON cm.channel_id=uc.id AND cm.model_code=m.model_code AND cm.status='active'
      WHERE permission.api_key_id=? AND permission.status='active'
      ORDER BY m.sort_order,m.model_code`).all(apiKey.id).map(model => ({
      model_code: model.model_code,
      model_name: model.model_name,
      model_type: model.model_type,
      context_length: model.context_length,
      sort_order: model.sort_order,
      protocol_types: model.protocol_type ? [model.protocol_type] : [],
        capabilities: {
          chat_completions: channelSupportsCapability(model, 'chat_completions'),
          anthropic_messages: channelSupportsCapability(model, 'anthropic_messages'),
          anthropic_count_tokens: channelSupportsCapability(model, 'anthropic_count_tokens'),
          image_input: (
            channelSupportsCapability(model, 'chat_completions')
            || channelSupportsCapability(model, 'anthropic_messages')
          ) && Number(model.is_multimodal) === 1,
          image_generations: channelSupportsCapability(model, 'image_generations'),
          ...imageOperationCapabilities(model),
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
  const rows = db.prepare(`SELECT cm.model_code,cm.supports_image_input,m.is_multimodal,uc.capabilities,uc.protocol_type
    FROM channel_models cm
    JOIN models m ON m.model_code=cm.model_code AND m.status='active'
    JOIN upstream_channels uc ON uc.id=cm.channel_id AND uc.status='active'
    WHERE cm.status='active'`).all();
  const capabilities = new Map();
  for (const row of rows) {
    const current = capabilities.get(row.model_code) || {
      chat_completions: false,
      anthropic_messages: false,
      anthropic_count_tokens: false,
      image_input: false,
      image_generations: false,
      ...emptyImageOperationCapabilities(),
      responses: false,
    };
    const supportsChat = channelSupportsCapability(row, 'chat_completions');
    const supportsAnthropicMessages = channelSupportsCapability(row, 'anthropic_messages');
    current.chat_completions ||= supportsChat;
    current.anthropic_messages ||= supportsAnthropicMessages;
    current.anthropic_count_tokens ||= channelSupportsCapability(row, 'anthropic_count_tokens');
    current.image_input ||= (supportsChat || supportsAnthropicMessages) && channelModelSupportsImageInput(row);
    current.image_generations ||= channelSupportsCapability(row, 'image_generations');
    mergeImageOperationCapabilities(current, imageOperationCapabilities(row));
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
      const current = capabilities.get(model.model_code) || {
        chat_completions: false,
        anthropic_messages: false,
        anthropic_count_tokens: false,
        image_input: false,
        image_generations: false,
        ...emptyImageOperationCapabilities(),
        responses: false,
      };
      current.chat_completions ||= Boolean(model.capabilities?.chat_completions);
      current.anthropic_messages ||= Boolean(model.capabilities?.anthropic_messages);
      current.anthropic_count_tokens ||= Boolean(model.capabilities?.anthropic_count_tokens);
      current.image_input ||= Boolean(model.capabilities?.image_input);
      current.image_generations ||= Boolean(model.capabilities?.image_generations);
      mergeImageOperationCapabilities(current, model.capabilities);
      current.responses ||= Boolean(model.capabilities?.responses);
      capabilities.set(model.model_code, current);
    }
  }
  return capabilities;
}

function listRoutingGroupChannelsForModel(db, groupId, modelCode, visitedGroups = new Set()) {
  if (!groupId || visitedGroups.has(groupId)) return [];
  visitedGroups.add(groupId);
  const group = db.prepare(`SELECT fallback_group_id,restrict_models
    FROM routing_groups WHERE id=? AND status='active'`).get(groupId);
  if (!group) return [];
  if (Number(group.restrict_models) === 1) {
    const allowed = db.prepare(`SELECT id FROM routing_group_models
      WHERE group_id=? AND model_code=? AND status='active'`).get(groupId, modelCode);
    if (!allowed) {
      return group.fallback_group_id
        ? listRoutingGroupChannelsForModel(db, group.fallback_group_id, modelCode, visitedGroups)
        : [];
    }
  }
  const channels = db.prepare(`SELECT uc.*
    FROM routing_group_channels rgc
    JOIN upstream_channels uc ON uc.id=rgc.channel_id AND uc.status='active'
    JOIN channel_models cm ON cm.channel_id=uc.id AND cm.model_code=? AND cm.status='active'
    WHERE rgc.group_id=? AND rgc.status='active'
    ORDER BY rgc.priority DESC,rgc.id ASC`).all(modelCode, groupId);
  if (!group.fallback_group_id) return channels;
  const fallbackChannels = listRoutingGroupChannelsForModel(
    db, group.fallback_group_id, modelCode, visitedGroups,
  );
  const byId = new Map(channels.map(channel => [channel.id, channel]));
  for (const channel of fallbackChannels) byId.set(channel.id, channel);
  return [...byId.values()];
}

function findUserChannelForModel(db, userId, modelCode) {
  const apiKeys = db.prepare(`SELECT id,routing_group_id,permission_mode FROM api_keys
    WHERE user_id=? AND status='active' ORDER BY id ASC`).all(userId);
  for (const apiKey of apiKeys) {
    if (!listModelsForApiKey(db, apiKey).some(model => model.model_code === modelCode)) continue;
    if (apiKey.routing_group_id) {
      const channel = listRoutingGroupChannelsForModel(
        db, apiKey.routing_group_id, modelCode,
      )[0];
      if (channel) return channel;
    }
  }
  const legacyModel = db.prepare(`SELECT channel_id FROM models
    WHERE model_code=? AND status='active'`).get(modelCode);
  return legacyModel?.channel_id
    ? db.prepare("SELECT * FROM upstream_channels WHERE id=? AND status='active'")
      .get(legacyModel.channel_id)
    : null;
}

module.exports = {
  mergeAvailableModel,
  listRoutingGroupModels,
  listRoutingGroupProtocolTypes,
  listModelsForApiKey,
  apiKeyCanUseModel,
  listSystemModelCapabilities,
  listUserModelCapabilities,
  listRoutingGroupChannelsForModel,
  findUserChannelForModel,
};
