import { describe, expect, it } from 'vitest';
import { parseOfficialPrices } from '../src/utils/pricing-sync.js';

describe('官方价格解析', () => {
  it('读取 OpenAI 模型页的输入、缓存输入和输出价格', () => {
    const html = '<div>Input</div><div class="price">$5.00</div><div>Cached input</div><div>$0.50</div><div>Output</div><div>$30.00</div>';
    expect(parseOfficialPrices(html, 'openai', 'gpt-5.5')).toMatchObject({ currency: 'USD', input: 5, cachedInput: 0.5, output: 30, unitTokens: 1_000_000 });
  });

  it('不在聚合价格页猜测模型价格', () => {
    expect(parseOfficialPrices('其他模型 Input $2 Output $0.5', 'anthropic', 'claude-sonnet-4')).toBeNull();
  });
});
