const CHANNEL_CAPABILITIES_BY_PROTOCOL = Object.freeze({
  openai_compatible: Object.freeze(['chat_completions', 'embeddings', 'image_generations', 'responses']),
  anthropic: Object.freeze(['anthropic_messages', 'anthropic_count_tokens']),
});
const DEFAULT_CHANNEL_CAPABILITIES = Object.freeze(['chat_completions']);
const ALLOWED_CHANNEL_CAPABILITIES = new Set(Object.values(CHANNEL_CAPABILITIES_BY_PROTOCOL).flat());

function defaultChannelCapabilities(protocolType = 'openai_compatible') {
  return [...(CHANNEL_CAPABILITIES_BY_PROTOCOL[protocolType] || DEFAULT_CHANNEL_CAPABILITIES)];
}

function parseChannelCapabilities(value, protocolType = 'openai_compatible') {
  if (Array.isArray(value)) return value.filter(item => ALLOWED_CHANNEL_CAPABILITIES.has(item));
  if (typeof value !== 'string' || !value.trim()) return defaultChannelCapabilities(protocolType);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(item => ALLOWED_CHANNEL_CAPABILITIES.has(item))
      : [];
  } catch (error) {
    return [];
  }
}

function serializeChannelCapabilities(value, protocolType = 'openai_compatible') {
  const protocolCapabilities = CHANNEL_CAPABILITIES_BY_PROTOCOL[protocolType];
  if (!protocolCapabilities) throw new Error('不支持的渠道协议');
  if (value === undefined || value === null) return JSON.stringify(defaultChannelCapabilities(protocolType));
  if (!Array.isArray(value)) throw new Error('渠道接口能力必须是数组');
  if (value.some(item => !ALLOWED_CHANNEL_CAPABILITIES.has(item))) throw new Error('包含不支持的渠道接口能力');
  if (value.some(item => !protocolCapabilities.includes(item))) throw new Error('接口能力与渠道协议不匹配');
  const capabilities = parseChannelCapabilities(value);
  if (capabilities.length === 0) throw new Error('渠道至少需要启用一种接口能力');
  return JSON.stringify([...new Set(capabilities)]);
}

function channelSupportsCapability(channel, capability) {
  return parseChannelCapabilities(channel?.capabilities, channel?.protocol_type).includes(capability);
}

function channelModelSupportsImageInput(channelModel) {
  if (channelModel?.supports_image_input !== null && channelModel?.supports_image_input !== undefined) {
    return Number(channelModel.supports_image_input) === 1;
  }
  return Number(channelModel?.is_multimodal) === 1;
}

module.exports = {
  ALLOWED_CHANNEL_CAPABILITIES,
  CHANNEL_CAPABILITIES_BY_PROTOCOL,
  DEFAULT_CHANNEL_CAPABILITIES,
  defaultChannelCapabilities,
  parseChannelCapabilities,
  serializeChannelCapabilities,
  channelSupportsCapability,
  channelModelSupportsImageInput,
};
