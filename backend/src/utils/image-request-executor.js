const multer = require('multer');
const FormData = require('form-data');

const IMAGE_MAX_FILES = 16;
const IMAGE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const INPUT_FIDELITIES = new Set(['low', 'high']);

const MULTIPART_FIELDS = Object.freeze({
  'images/edits': Object.freeze([
    'model', 'prompt', 'n', 'size', 'quality', 'response_format', 'background',
    'output_format', 'output_compression', 'moderation', 'input_fidelity', 'user',
  ]),
  'images/variations': Object.freeze(['model', 'n', 'size', 'response_format', 'user']),
  'images/transformations': Object.freeze([
    'model', 'prompt', 'size', 'quality', 'response_format', 'background',
    'output_format', 'output_compression', 'moderation', 'input_fidelity', 'user',
  ]),
});

function requestError(message, type = 'invalid_image_request') {
  const error = new Error(message);
  error.type = type;
  error.status = 400;
  return error;
}

function imageOperationForEndpoint(endpoint) {
  if (endpoint === 'images/edits') return 'edit';
  if (endpoint === 'images/variations') return 'variation';
  if (endpoint === 'images/transformations') return 'transformation';
  return 'generation';
}

function arrayValue(value) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function compactBody(body = {}) {
  return Object.fromEntries(Object.entries(body)
    .map(([key, value]) => [key, arrayValue(value)])
    .filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function detectedImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function imageFilesFromRequest(req) {
  const fields = req.files || {};
  const images = [...(fields.image || []), ...(fields['image[]'] || [])];
  const masks = fields.mask || [];
  if (images.length > IMAGE_MAX_FILES) throw requestError(`最多上传 ${IMAGE_MAX_FILES} 张输入图片`, 'too_many_image_inputs');
  if (masks.length > 1) throw requestError('最多上传一张蒙版图片', 'too_many_image_masks');
  const allFiles = [...images, ...masks];
  const totalBytes = allFiles.reduce((total, file) => total + Number(file.size || 0), 0);
  if (totalBytes > IMAGE_MAX_TOTAL_BYTES) {
    throw requestError('图片上传总大小超过 50MB 限制', 'image_upload_too_large');
  }
  for (const file of allFiles) {
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw requestError('仅支持 PNG、JPEG 和 WebP 图片', 'unsupported_image_type');
    }
    if (detectedImageMimeType(file.buffer) !== file.mimetype) {
      throw requestError('图片内容与声明格式不一致', 'image_content_type_mismatch');
    }
  }
  return { images, mask: masks[0] || null, totalBytes };
}

function cappedMemoryStorage() {
  return {
    _handleFile(req, file, callback) {
      const chunks = [];
      let size = 0;
      let completed = false;
      const finish = (error, info) => {
        if (completed) return;
        completed = true;
        callback(error, info);
      };

      file.stream.on('data', chunk => {
        if (completed) return;
        const buffer = Buffer.from(chunk);
        const totalBytes = Number(req._imageUploadTotalBytes || 0) + buffer.length;
        req._imageUploadTotalBytes = totalBytes;
        if (totalBytes > IMAGE_MAX_TOTAL_BYTES) {
          const error = new multer.MulterError('LIMIT_TOTAL_FILE_SIZE', file.fieldname);
          error.message = '图片上传总大小超过 50MB 限制';
          finish(error);
          return;
        }
        chunks.push(buffer);
        size += buffer.length;
      });
      file.stream.on('error', error => finish(error));
      file.stream.on('limit', () => finish(new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname)));
      file.stream.on('end', () => finish(null, { buffer: Buffer.concat(chunks), size }));
    },
    _removeFile(req, file, callback) {
      delete file.buffer;
      callback(null);
    },
  };
}

function parsePositiveInteger(value, field, { max = 10, fallback = 1 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw requestError(`${field} 必须是 1 到 ${max} 的整数`, 'invalid_image_parameter');
  }
  return parsed;
}

function parseCompression(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw requestError('output_compression 必须是 0 到 100 的整数', 'invalid_image_parameter');
  }
  return parsed;
}

function assertSupportedFields(endpoint, body) {
  const allowed = new Set(MULTIPART_FIELDS[endpoint] || []);
  const common = new Set(['image', 'image[]', 'mask']);
  const unsupported = Object.keys(body).find(field => !allowed.has(field) && !common.has(field));
  if (unsupported) throw requestError(`不支持图片参数 ${unsupported}`, 'unsupported_image_parameter');
}

function validateImageRequest({ endpoint, body = {}, files }) {
  const normalized = compactBody(body);
  if (!String(normalized.model || '').trim()) throw requestError('图片请求必须指定模型', 'missing_model');
  if (endpoint !== 'images/generations' && files.images.length === 0) {
    throw requestError('图片编辑、变体和变换请求必须上传至少一张图片', 'image_input_required');
  }
  if (['images/edits', 'images/transformations'].includes(endpoint) && !String(normalized.prompt || '').trim()) {
    throw requestError('图片编辑和变换请求必须提供 prompt', 'prompt_required');
  }
  assertSupportedFields(endpoint, normalized);
  if (endpoint === 'images/variations' && files.mask) {
    throw requestError('图片变体接口不支持 mask 参数', 'unsupported_image_parameter');
  }
  if (endpoint === 'images/variations' && files.images.length !== 1) {
    throw requestError('图片变体接口只能上传一张图片', 'invalid_image_input_count');
  }
  const format = String(normalized.output_format || '').toLowerCase();
  if (format && !OUTPUT_FORMATS.has(format)) {
    throw requestError('output_format 仅支持 png、jpeg 或 webp', 'invalid_image_parameter');
  }
  const fidelity = String(normalized.input_fidelity || '').toLowerCase();
  if (fidelity && !INPUT_FIDELITIES.has(fidelity)) {
    throw requestError('input_fidelity 仅支持 low 或 high', 'invalid_image_parameter');
  }
  return {
    ...normalized,
    n: parsePositiveInteger(normalized.n, 'n'),
    ...(format ? { output_format: format } : {}),
    ...(fidelity ? { input_fidelity: fidelity } : {}),
    ...(parseCompression(normalized.output_compression) !== undefined
      ? { output_compression: parseCompression(normalized.output_compression) }
      : {}),
  };
}

function appendFields(form, body, fields) {
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null || value === '') continue;
    form.append(field, String(value));
  }
}

function appendFile(form, field, file) {
  form.append(field, file.buffer, {
    filename: file.originalname || `${field}.png`,
    contentType: file.mimetype,
    knownLength: file.size,
  });
}

function createMultipartPayload({ endpoint, body, files }) {
  const form = new FormData();
  appendFields(form, body, MULTIPART_FIELDS[endpoint] || []);
  for (const image of files.images) appendFile(form, 'image', image);
  if (endpoint === 'images/edits' && files.mask) appendFile(form, 'mask', files.mask);
  return { data: form, headers: form.getHeaders() };
}

function dataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

function createTransformationBody(body, files) {
  const tool = {
    type: 'image_generation',
    model: body.model,
    action: 'edit',
  };
  for (const field of ['size', 'quality', 'background', 'input_fidelity', 'output_format', 'output_compression', 'moderation']) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '') tool[field] = body[field];
  }
  if (files.mask) tool.input_image_mask = { image_url: dataUrl(files.mask) };
  return {
    model: body.model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: body.prompt },
        ...files.images.map(file => ({ type: 'input_image', image_url: dataUrl(file) })),
      ],
    }],
    tools: [tool],
    tool_choice: { type: 'image_generation' },
    stream: false,
  };
}

function createImageUploadMiddleware() {
  const upload = multer({
    storage: cappedMemoryStorage(),
    limits: {
      files: IMAGE_MAX_FILES + 1,
      fileSize: IMAGE_MAX_FILE_BYTES,
      fieldSize: 256 * 1024,
      fields: 32,
    },
  }).fields([
    { name: 'image', maxCount: IMAGE_MAX_FILES },
    { name: 'image[]', maxCount: IMAGE_MAX_FILES },
    { name: 'mask', maxCount: 1 },
  ]);
  return (req, res, next) => {
    req._imageUploadTotalBytes = 0;
    return upload(req, res, error => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? '单张图片超过 25MB 限制'
      : error.code === 'LIMIT_FILE_COUNT'
        ? `最多上传 ${IMAGE_MAX_FILES} 张输入图片和一张蒙版`
        : error.code === 'LIMIT_TOTAL_FILE_SIZE'
          ? '图片上传总大小超过 50MB 限制'
        : '图片 multipart 请求无效';
    return res.status(400).json({ error: { message, type: 'invalid_image_upload' } });
    });
  };
}

class ImageRequestExecutor {
  constructor({ postWithSafeFailover }) {
    this.postWithSafeFailover = postWithSafeFailover;
  }

  prepare({ endpoint, body, files }) {
    const validatedBody = validateImageRequest({ endpoint, body, files });
    const operation = imageOperationForEndpoint(endpoint);
    if (endpoint === 'images/transformations') {
      return {
        endpoint: 'responses',
        operation,
        body: createTransformationBody(validatedBody, files),
        metadata: {
          inputCount: files.images.length,
          outputFormat: validatedBody.output_format || '',
          outputCompression: validatedBody.output_compression ?? null,
        },
      };
    }
    return {
      endpoint,
      operation,
      body: validatedBody,
      files,
      metadata: {
        inputCount: files.images.length,
        outputFormat: validatedBody.output_format || '',
        outputCompression: validatedBody.output_compression ?? null,
      },
    };
  }

  execute({ prepared, ...options }) {
    return this.postWithSafeFailover({
      ...options,
      endpoint: prepared.endpoint,
      body: prepared.body,
      ...(prepared.files ? {
        createRequest: requestBody => createMultipartPayload({
          endpoint: prepared.endpoint,
          body: requestBody,
          files: prepared.files,
        }),
      } : {}),
    });
  }
}

module.exports = {
  IMAGE_MAX_FILES,
  IMAGE_MAX_FILE_BYTES,
  IMAGE_MAX_TOTAL_BYTES,
  ImageRequestExecutor,
  cappedMemoryStorage,
  detectedImageMimeType,
  createImageUploadMiddleware,
  imageFilesFromRequest,
  imageOperationForEndpoint,
  requestError,
};
