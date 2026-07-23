const STANDARD_IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536']);
const IMAGE_BILLING_TIERS = ['1K', '2K', '4K'];

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

function classifyImageBillingTier(value) {
  const size = String(value || '').trim().toLowerCase();
  if (!size || size === 'auto') return null;
  if (['1k', '2k', '4k'].includes(size)) return size.toUpperCase();
  const match = size.match(/^(\d+)\s*x\s*(\d+)$/);
  if (!match) return null;
  const maxEdge = Math.max(Number(match[1]), Number(match[2]));
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return null;
  if (maxEdge <= 1024) return '1K';
  if (maxEdge <= 2048) return '2K';
  return '4K';
}

function normalizeImageBillingTier(value) {
  return classifyImageBillingTier(value) || '2K';
}

function imageTierRank(value) {
  return IMAGE_BILLING_TIERS.indexOf(String(value || '').toUpperCase()) + 1;
}

function resolveImageBillingSize({ inputSize = '', outputSizes = [] } = {}) {
  const compactOutputSizes = outputSizes.map(value => String(value || '').trim()).filter(Boolean);
  const breakdown = {};
  let outputTier = null;
  for (const outputSize of compactOutputSizes) {
    const tier = classifyImageBillingTier(outputSize);
    if (!tier) continue;
    breakdown[tier] = (breakdown[tier] || 0) + 1;
    if (imageTierRank(tier) > imageTierRank(outputTier)) outputTier = tier;
  }
  if (outputTier) {
    return {
      billingSize: outputTier,
      inputSize: String(inputSize || '').trim(),
      outputSize: compactOutputSizes[0] || '',
      source: 'output',
      breakdown: Object.fromEntries(IMAGE_BILLING_TIERS.filter(tier => breakdown[tier]).map(tier => [tier, breakdown[tier]])),
    };
  }
  const inputTier = classifyImageBillingTier(inputSize);
  if (inputTier) {
    return {
      billingSize: inputTier,
      inputSize: String(inputSize || '').trim(),
      outputSize: compactOutputSizes[0] || '',
      source: 'input',
      breakdown: null,
    };
  }
  return {
    billingSize: '2K',
    inputSize: String(inputSize || '').trim(),
    outputSize: compactOutputSizes[0] || '',
    source: 'default',
    breakdown: null,
  };
}

function explicitImageSize(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.size) return String(item.size);
  const width = Number(item.width);
  const height = Number(item.height);
  return width > 0 && height > 0 ? `${width}x${height}` : '';
}

function decodeImageDimensions(encoded) {
  if (typeof encoded !== 'string' || !encoded.trim()) return '';
  const base64 = encoded.includes(',') ? encoded.slice(encoded.indexOf(',') + 1) : encoded;
  let buffer;
  try { buffer = Buffer.from(base64, 'base64'); } catch (error) { return ''; }
  if (buffer.length >= 24
      && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
  }
  if (buffer.length >= 30
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP'
      && buffer.toString('ascii', 12, 16) === 'VP8X') {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return `${width}x${height}`;
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return `${buffer.readUInt16BE(offset + 7)}x${buffer.readUInt16BE(offset + 5)}`;
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return '';
}

function generatedImageOutputSizes(payload = {}) {
  const items = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.output)
      ? payload.output.filter(item => item?.type === 'image_generation_call')
      : [];
  return items.map(item => {
    const explicit = explicitImageSize(item);
    if (explicit) return explicit;
    return decodeImageDimensions(item?.b64_json || item?.result || item?.output || item?.image);
  }).filter(Boolean);
}

function imageBillingIntent({ endpoint, body = {} } = {}) {
  const normalizedEndpoint = String(endpoint || '').replace(/^\/?v1\//, '').replace(/^\/+/, '');
  if (normalizedEndpoint === 'images/generations') {
    return {
      billingModel: String(body.model || '').trim(),
      size: String(body.size || 'auto').trim(),
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
      size: String(imageTool?.size || body.size || 'auto').trim(),
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
  classifyImageBillingTier,
  countGeneratedImages,
  generatedImageOutputSizes,
  imageBillingIntent,
  imagePriceForSize,
  normalizeImageBillingTier,
  normalizeImageSize,
  resolveImageBillingSize,
};
