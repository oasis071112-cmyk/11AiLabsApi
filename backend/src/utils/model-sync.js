function normalizeUpstreamModels(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return [...new Set(rows.map(row => row?.id || row?.name).filter(Boolean))].sort();
}

function inferModelType(modelCode) {
  return modelCode.startsWith('gpt-image-') ? 'image' : 'llm';
}

module.exports = { normalizeUpstreamModels, inferModelType };
