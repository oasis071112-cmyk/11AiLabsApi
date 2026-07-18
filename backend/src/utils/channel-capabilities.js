const DEFAULT_CHANNEL_CAPABILITIES = Object.freeze(['chat_completions']);
const ALLOWED_CHANNEL_CAPABILITIES = new Set(['chat_completions', 'embeddings']);

function parseChannelCapabilities(value) {
  if (Array.isArray(value)) return value.filter(item => ALLOWED_CHANNEL_CAPABILITIES.has(item));
  if (typeof value !== 'string' || !value.trim()) return [...DEFAULT_CHANNEL_CAPABILITIES];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(item => ALLOWED_CHANNEL_CAPABILITIES.has(item))
      : [];
  } catch (error) {
    return [];
  }
}

function serializeChannelCapabilities(value) {
  if (value === undefined || value === null) return JSON.stringify(DEFAULT_CHANNEL_CAPABILITIES);
  if (!Array.isArray(value)) throw new Error('渠道接口能力必须是数组');
  if (value.some(item => !ALLOWED_CHANNEL_CAPABILITIES.has(item))) throw new Error('包含不支持的渠道接口能力');
  const capabilities = parseChannelCapabilities(value);
  if (capabilities.length === 0) throw new Error('渠道至少需要启用一种接口能力');
  return JSON.stringify([...new Set(capabilities)]);
}

function channelSupportsCapability(channel, capability) {
  return parseChannelCapabilities(channel?.capabilities).includes(capability);
}

function channelModelSupportsImageInput(channelModel) {
  if (channelModel?.supports_image_input !== null && channelModel?.supports_image_input !== undefined) {
    return Number(channelModel.supports_image_input) === 1;
  }
  return Number(channelModel?.is_multimodal) === 1;
}

module.exports = {
  ALLOWED_CHANNEL_CAPABILITIES,
  DEFAULT_CHANNEL_CAPABILITIES,
  parseChannelCapabilities,
  serializeChannelCapabilities,
  channelSupportsCapability,
  channelModelSupportsImageInput,
};
