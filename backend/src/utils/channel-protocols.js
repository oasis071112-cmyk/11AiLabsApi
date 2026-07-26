const CHANNEL_PROTOCOLS = Object.freeze({
  OPENAI_COMPATIBLE: 'openai_compatible',
  ANTHROPIC: 'anthropic',
});

const SUPPORTED_CHANNEL_PROTOCOLS = new Set(Object.values(CHANNEL_PROTOCOLS));
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

function isSupportedChannelProtocol(protocolType) {
  return SUPPORTED_CHANNEL_PROTOCOLS.has(protocolType);
}

function upstreamRequestHeaders(channel, {
  contentType = '',
  accept = '',
  anthropicVersion = DEFAULT_ANTHROPIC_VERSION,
  anthropicBeta = '',
} = {}) {
  const headers = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (accept) headers.Accept = accept;

  if (channel?.protocol_type === CHANNEL_PROTOCOLS.ANTHROPIC) {
    headers['x-api-key'] = channel.api_key;
    headers['anthropic-version'] = String(anthropicVersion || DEFAULT_ANTHROPIC_VERSION);
    if (anthropicBeta) headers['anthropic-beta'] = String(anthropicBeta);
    return headers;
  }

  headers.Authorization = `Bearer ${channel?.api_key || ''}`;
  return headers;
}

module.exports = {
  CHANNEL_PROTOCOLS,
  DEFAULT_ANTHROPIC_VERSION,
  SUPPORTED_CHANNEL_PROTOCOLS,
  isSupportedChannelProtocol,
  upstreamRequestHeaders,
};
