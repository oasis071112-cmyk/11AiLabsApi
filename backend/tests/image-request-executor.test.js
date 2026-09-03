import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const {
  IMAGE_MAX_FILES,
  IMAGE_MAX_TOTAL_BYTES,
  ImageRequestExecutor,
  cappedMemoryStorage,
  imageFilesFromRequest,
} = require('../src/utils/image-request-executor.js');

function imageBytes(mimetype) {
  if (mimetype === 'image/jpeg') return Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  if (mimetype === 'image/webp') return Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function file(name, mimetype = 'image/png', content = null) {
  const buffer = content === null ? imageBytes(mimetype) : Buffer.from(content);
  return {
    originalname: name,
    mimetype,
    buffer,
    size: buffer.length,
  };
}

describe('ImageRequestExecutor', () => {
  it('接受 Codex JSON 图片编辑并保留远程引用给上游', () => {
    const executor = new ImageRequestExecutor({ postWithSafeFailover: options => options });
    const pngDataUrl = `data:image/png;base64,${imageBytes('image/png').toString('base64')}`;
    const prepared = executor.prepare({
      endpoint: 'images/edits',
      body: {
        model: 'image-model',
        prompt: 'change the lighting',
        images: [
          { image_url: pngDataUrl },
          { image_url: 'https://example.test/reference.webp' },
        ],
        output_format: 'webp',
        output_compression: 60,
      },
    });

    expect(prepared).toEqual({
      endpoint: 'images/edits',
      operation: 'edit',
      body: {
        model: 'image-model',
        prompt: 'change the lighting',
        images: [
          { image_url: pngDataUrl },
          { image_url: 'https://example.test/reference.webp' },
        ],
        n: 1,
        output_format: 'webp',
        output_compression: 60,
      },
      metadata: { inputCount: 2, outputFormat: 'webp', outputCompression: 60 },
    });
  });

  it('拒绝无效、非 HTTPS、超量或过大的 Codex JSON 图片引用', () => {
    const executor = new ImageRequestExecutor({ postWithSafeFailover: options => options });
    const request = images => ({
      endpoint: 'images/edits',
      body: { model: 'image-model', prompt: 'change it', images },
    });
    expect(() => executor.prepare(request([{ image_url: 'http://example.test/source.png' }]))).toThrow('HTTPS');
    expect(() => executor.prepare(request([{ image_url: 'data:image/png;base64,bm90LWEtcG5n' }]))).toThrow('格式不一致');
    expect(() => executor.prepare(request(Array.from(
      { length: IMAGE_MAX_FILES + 1 },
      () => ({ image_url: 'https://example.test/source.png' }),
    )))).toThrow('最多提供');
    const oversized = Buffer.concat([imageBytes('image/png'), Buffer.alloc(25 * 1024 * 1024)]);
    expect(() => executor.prepare(request([{
      image_url: `data:image/png;base64,${oversized.toString('base64')}`,
    }]))).toThrow('单张图片超过');
  });


  it('将扩展变换转换为非流式 Responses 图片编辑工具', () => {
    const executor = new ImageRequestExecutor({ postWithSafeFailover: options => options });
    const files = { images: [file('source.jpg', 'image/jpeg')], mask: file('mask.png') };
    const prepared = executor.prepare({
      endpoint: 'images/transformations',
      body: {
        model: 'image-model', prompt: 'compress without changing the subject',
        output_format: 'webp', output_compression: '55', input_fidelity: 'high',
      },
      files,
    });

    expect(prepared).toMatchObject({
      endpoint: 'responses',
      operation: 'transformation',
      metadata: { inputCount: 1, outputFormat: 'webp', outputCompression: 55 },
      body: {
        stream: false,
        tool_choice: { type: 'image_generation' },
        tools: [{
          type: 'image_generation', action: 'edit', output_format: 'webp',
          output_compression: 55, input_fidelity: 'high',
          input_image_mask: { image_url: expect.stringContaining('data:image/png;base64,') },
        }],
      },
    });
    expect(prepared.body.input[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_image', image_url: expect.stringContaining('data:image/jpeg;base64,') }),
    ]));
  });

  it('为每次故障切换重新创建 multipart payload', () => {
    const executor = new ImageRequestExecutor({ postWithSafeFailover: options => options });
    const prepared = executor.prepare({
      endpoint: 'images/edits',
      body: { model: 'image-model', prompt: 'change color', n: '1' },
      files: { images: [file('source.png')], mask: null },
    });
    const options = executor.execute({ prepared, modelCode: 'image-model' });
    const first = options.createRequest({ ...prepared.body, model: 'mapped-a' });
    const second = options.createRequest({ ...prepared.body, model: 'mapped-b' });

    expect(first.headers['content-type']).toContain('multipart/form-data');
    expect(second.headers['content-type']).toContain('multipart/form-data');
    expect(first.headers['content-type']).not.toBe(second.headers['content-type']);
  });

  it('拒绝缺少图片、超出数量、非图片格式或无效压缩参数的请求', () => {
    const executor = new ImageRequestExecutor({ postWithSafeFailover: options => options });
    expect(() => executor.prepare({
      endpoint: 'images/edits',
      body: { model: 'image-model', prompt: 'change' },
      files: { images: [], mask: null },
    })).toThrow('至少一张图片');
    expect(() => imageFilesFromRequest({ files: {
      image: Array.from({ length: IMAGE_MAX_FILES + 1 }, (_, index) => file(`${index}.png`)),
    } })).toThrow('最多上传');
    expect(() => imageFilesFromRequest({ files: { image: [file('bad.gif', 'image/gif')] } })).toThrow('仅支持 PNG');
    expect(() => imageFilesFromRequest({ files: {
      image: [file('spoofed.png', 'image/png', 'not an image')],
    } })).toThrow('内容与声明格式不一致');
    expect(() => executor.prepare({
      endpoint: 'images/transformations',
      body: { model: 'image-model', prompt: 'change', output_compression: '101' },
      files: { images: [file('source.png')], mask: null },
    })).toThrow('output_compression');
    expect(() => executor.prepare({
      endpoint: 'images/variations',
      body: { model: 'image-model' },
      files: { images: [file('first.png'), file('second.png')], mask: null },
    })).toThrow('只能上传一张');
  });

  it('在 multipart 流解析期间拒绝超过总上传大小的文件', async () => {
    const storage = cappedMemoryStorage();
    const error = await new Promise(resolve => storage._handleFile(
      {},
      { fieldname: 'image', stream: Readable.from([Buffer.alloc(IMAGE_MAX_TOTAL_BYTES + 1)]) },
      failure => resolve(failure),
    ));
    expect(error).toMatchObject({ code: 'LIMIT_TOTAL_FILE_SIZE', message: '图片上传总大小超过 50MB 限制' });
  });
});
