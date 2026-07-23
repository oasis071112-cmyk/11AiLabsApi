const STANDARD_IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);

function positiveInteger(value, fallback = 1) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeImageSize(value) {
  const size = String(value || 'auto').trim().toLowerCase();
  if (STANDARD_IMAGE_SIZES.has(size)) return size;
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return '1024x1024';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width === height) return '1024x1024';
  return width > height ? '1536x1024' : '1024x1536';
}

function imageBillingIntent({ endpoint, body = {} } = {}) {
  const normalizedEndpoint = String(endpoint || '').replace(/^\/?v1\//, '').replace(/^\/+/, '');
  if (normalizedEndpoint === 'images/generations') {
    return {
      billingModel: String(body.model || '').trim(),
      size: normalizeImageSize(body.size),
      quality: String(body.quality || 'auto').trim().toLowerCase(),
      requestedCount: positiveInteger(body.n),
      source: 'images_endpoint',
    };
  }
  if (normalizedEndpoint === 'responses') {
    const imageTool = Array.isArray(body.tools)
      ? body.tools.find(tool => tool?.type === 'image_generation')
      : null;
    const explicitlySelected = body.tool_choice === 'image_generation'
      || body.tool_choice?.type === 'image_generation';
    const imageModelRequest = String(body.model || '').startsWith('gpt-image-');
    if (!imageTool && !explicitlySelected && !imageModelRequest) return null;
    return {
      billingModel: String(imageTool?.model || (imageModelRequest ? body.model : 'gpt-image-2')).trim(),
      size: normalizeImageSize(imageTool?.size || body.size),
      quality: String(imageTool?.quality || body.quality || 'auto').trim().toLowerCase(),
      requestedCount: positiveInteger(imageTool?.n || body.n),
      source: imageTool || explicitlySelected ? 'responses_tool' : 'responses_image_model',
    };
  }
  return null;
}

function countGeneratedImages(payload = {}) {
  if (Array.isArray(payload.data)) {
    return payload.data.filter(item => Boolean(item?.b64_json || item?.url || item?.revised_prompt && item?.image)).length;
  }
  if (!Array.isArray(payload.output)) return 0;
  return payload.output.filter(item => item?.type === 'image_generation_call'
    && Boolean(item.result || item.output || item.image_url)).length;
}

function imagePriceForSize(serializedPrices, size) {
  let prices = serializedPrices;
  if (typeof prices === 'string') {
    try { prices = JSON.parse(prices); } catch (error) { prices = {}; }
  }
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return 0;
  const normalizedSize = normalizeImageSize(size);
  const exact = Number(prices[normalizedSize]);
  if (Number.isFinite(exact) && exact >= 0) return exact;
  const fallback = Number(prices.default);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

module.exports = {
  countGeneratedImages,
  imageBillingIntent,
  imagePriceForSize,
  normalizeImageSize,
};
