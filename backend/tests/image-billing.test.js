import { describe, expect, it } from 'vitest';
import {
  classifyImageBillingTier,
  countGeneratedImages,
  generatedImageOutputSizes,
  imageBillingIntent,
  imagePriceForSize,
  normalizeImageSize,
  resolveImageBillingSize,
} from '../src/utils/image-billing.js';

describe('Sub2API 风格图片生成计费', () => {
  it('将常见横竖尺寸归一化，并为 auto 使用方形默认值', () => {
    expect(normalizeImageSize('auto')).toBe('1024x1024');
    expect(normalizeImageSize('1536x1024')).toBe('1536x1024');
    expect(normalizeImageSize('1024x1536')).toBe('1024x1536');
    expect(normalizeImageSize('1792x1024')).toBe('1536x1024');
  });

  it('从专用图片端点请求读取模型与尺寸', () => {
    expect(imageBillingIntent({
      endpoint: 'images/generations',
      body: { model: 'gpt-image-1', size: '1024x1536', quality: 'high', n: 2 },
    })).toEqual({
      billingModel: 'gpt-image-1',
      size: '1024x1536',
      quality: 'high',
      requestedCount: 2,
      source: 'images_endpoint',
    });
  });

  it('从 Responses 原生 image_generation 工具读取图片计费模型', () => {
    expect(imageBillingIntent({
      endpoint: 'responses',
      body: {
        model: 'gpt-5.4',
        tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1536x1024' }],
      },
    })).toMatchObject({
      billingModel: 'gpt-image-2',
      size: '1536x1024',
      source: 'responses_tool',
    });
  });

  it('只有非空图片结果才计入实际张数', () => {
    expect(countGeneratedImages({
      data: [{ b64_json: 'abc' }, { url: 'https://example.test/image.png' }, {}],
    })).toBe(2);
    expect(countGeneratedImages({
      output: [
        { type: 'message', content: [] },
        { type: 'image_generation_call', result: 'abc' },
        { type: 'image_generation_call', result: '' },
      ],
    })).toBe(1);
  });

  it('按精确尺寸取价，缺失时回退 default', () => {
    const prices = JSON.stringify({
      default: 0.04,
      '1024x1536': 0.08,
    });
    expect(imagePriceForSize(prices, '1024x1536')).toBe(0.08);
    expect(imagePriceForSize(prices, '1536x1024')).toBe(0.04);
  });

  it('按 Sub2API 的 1K/2K/4K 档位归类，auto 默认 2K', () => {
    expect(classifyImageBillingTier('1024x1024')).toBe('1K');
    expect(classifyImageBillingTier('1536x1024')).toBe('2K');
    expect(classifyImageBillingTier('3840x2160')).toBe('4K');
    expect(classifyImageBillingTier('auto')).toBeNull();
    expect(resolveImageBillingSize({ inputSize: 'auto', outputSizes: [] })).toMatchObject({
      billingSize: '2K',
      source: 'default',
    });
  });

  it('实际输出尺寸优先于请求尺寸，多图按最高档结算', () => {
    expect(resolveImageBillingSize({
      inputSize: '1024x1024',
      outputSizes: ['1024x1024', '2160x3840'],
    })).toEqual({
      billingSize: '4K',
      inputSize: '1024x1024',
      outputSize: '1024x1024',
      source: 'output',
      breakdown: { '1K': 1, '4K': 1 },
    });
  });

  it('从图片响应的显式尺寸字段收集实际输出尺寸', () => {
    expect(generatedImageOutputSizes({
      data: [
        { b64_json: 'abc', size: '1024x1024' },
        { url: 'https://example.test/image.png', width: 2048, height: 1152 },
      ],
    })).toEqual(['1024x1024', '2048x1152']);
  });
});
