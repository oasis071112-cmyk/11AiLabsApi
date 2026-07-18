import { describe, expect, it } from 'vitest';
import { resolveChatOutputLimit } from '../src/utils/request-limits.js';

describe('聊天请求输出上限', () => {
  it('低价 DeepSeek 模型不能把余额换算成超过上游上限的 max_tokens', () => {
    expect(resolveChatOutputLimit({
      model: { official_provider: 'deepseek', context_length: 0 },
      requestBody: { model: 'deepseek-v4-flash' },
      estimatedInputTokens: 300,
      maxAffordableOutput: 3_450_000,
    })).toEqual({ limitField: 'max_tokens', maxTokens: 4096 });
  });

  it('所有模型均受配置的上下文长度约束', () => {
    expect(resolveChatOutputLimit({
      model: { official_provider: 'openai', model_code: 'gpt-5.5', context_length: 8192 },
      requestBody: { max_completion_tokens: 8000 },
      estimatedInputTokens: 512,
      maxAffordableOutput: 50_000,
    })).toEqual({ limitField: 'max_completion_tokens', maxTokens: 7680 });
  });

  it('客户端指定较小上限时保持其意图', () => {
    expect(resolveChatOutputLimit({
      model: { official_provider: 'deepseek', context_length: 128000 },
      requestBody: { max_tokens: 256 },
      estimatedInputTokens: 512,
      maxAffordableOutput: 20_000,
    })).toEqual({ limitField: 'max_tokens', maxTokens: 256 });
  });
});
