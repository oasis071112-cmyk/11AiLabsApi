import { describe, it, expect } from 'vitest';
import { normalizeUpstreamModels, inferModelType } from '../src/utils/model-sync.js';

describe('上游模型同步', () => {
  it('应完整读取、去重并排序 OpenAI 兼容模型 ID', () => {
    const payload = { data: [
      { id: 'gpt-5.5' },
      { id: 'gpt-5.4' },
      { id: 'gpt-5.5' },
      { id: '' },
      null
    ] };
    expect(normalizeUpstreamModels(payload)).toEqual(['gpt-5.4', 'gpt-5.5']);
  });

  it('应兼容 models/name 格式并识别图片模型', () => {
    expect(normalizeUpstreamModels({ models: [{ name: 'gpt-image-2' }] })).toEqual(['gpt-image-2']);
    expect(inferModelType('gpt-image-2')).toBe('image');
    expect(inferModelType('gpt-5.5')).toBe('llm');
  });
});
