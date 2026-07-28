import { describe, expect, it } from 'vitest';
import { parseOfficialPrices } from '../src/utils/pricing-sync.js';

describe('官方价格解析', () => {
  it('读取 OpenAI 模型页的输入、缓存输入和输出价格', () => {
    const html = '<div>Input</div><div class="price">$5.00</div><div>Cached input</div><div>$0.50</div><div>Output</div><div>$30.00</div>';
    expect(parseOfficialPrices(html, 'openai', 'gpt-5.5')).toMatchObject({ currency: 'USD', input: 5, cachedInput: 0.5, output: 30, unitTokens: 1_000_000 });
  });

  it('不在聚合价格页猜测模型价格', () => {
    expect(parseOfficialPrices('其他模型 Input $2 Output $0.5', 'anthropic', 'claude-sonnet-4', 'Claude Sonnet 4')).toBeNull();
  });

  it('使用官方模型标识主匹配并用显示名称校验 Anthropic 价格', () => {
    const html = 'Claude Haiku 4.5 claude-haiku-4-5-20251001 Input $1 Cached input $0.10 Output $5';
    expect(parseOfficialPrices(html, 'anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5')).toMatchObject({
      currency: 'USD', input: 1, cachedInput: 0.1, output: 5,
    });
  });

  it('官方模型标识与显示名称型号冲突时拒绝同步', () => {
    const html = 'Claude Haiku 4.5 claude-haiku-4-5-20251001 Input $1 Output $5';
    expect(parseOfficialPrices(html, 'anthropic', 'claude-haiku-4-5-20251001', 'Claude Sonnet 4.5')).toBeNull();
  });

  it('不跨主版本匹配 Anthropic 模型', () => {
    const html = 'Claude Haiku 4.6 claude-haiku-4-6-20260101 Input $2 Output $8';
    expect(parseOfficialPrices(html, 'anthropic', 'Claude Haiku 4.5', 'Claude Haiku 4.5')).toBeNull();
  });

  it('同模型多个日期版本逐项采用官方文档中的最高标准价格', () => {
    const html = [
      'Claude Haiku 4.5 claude-haiku-4-5-20251001 Input $1 Cached input $0.10 Output $5',
      'Claude Haiku 4.5 claude-haiku-4-5-20251215 Input $1.20 Cached input $0.08 Output $4.80',
    ].join(' ');
    expect(parseOfficialPrices(html, 'anthropic', 'Claude Haiku 4.5', 'Claude Haiku 4.5')).toMatchObject({
      currency: 'USD', input: 1.2, cachedInput: 0.1, output: 5,
    });
  });

  it('指定日期的官方模型标识不会自动匹配其他日期版本', () => {
    const html = 'Claude Haiku 4.5 claude-haiku-4-5-20251215 Input $1.20 Output $4.80';
    expect(parseOfficialPrices(html, 'anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5')).toBeNull();
  });

  it('不会把 Batch 或长上下文价格混入标准价格', () => {
    const html = [
      'Claude Haiku 4.5 Standard Input $1 Cached input $0.10 Output $5',
      'Batch Input $0.50 Output $2.50',
      'Long context Input $3 Output $15',
    ].join(' ');
    expect(parseOfficialPrices(html, 'anthropic', 'Claude Haiku 4.5', 'Claude Haiku 4.5')).toMatchObject({
      currency: 'USD', input: 1, cachedInput: 0.1, output: 5,
    });
  });

  it('特殊定价位于标准价格之前时仍只读取 Standard 区块', () => {
    const html = [
      'Claude Haiku 4.5 Batch Input $0.50 Cached input $0.05 Output $2.50',
      'Long context Input $3 Output $15',
      'Standard Input $1 Cached input $0.10 Output $5',
    ].join(' ');
    expect(parseOfficialPrices(html, 'anthropic', 'Claude Haiku 4.5', 'Claude Haiku 4.5')).toMatchObject({
      currency: 'USD', input: 1, cachedInput: 0.1, output: 5,
    });
  });

  it('只有特殊定价而没有 Standard 区块时拒绝同步', () => {
    const html = 'Claude Haiku 4.5 Batch Input $0.50 Output $2.50 Long context Input $3 Output $15';
    expect(parseOfficialPrices(html, 'anthropic', 'Claude Haiku 4.5', 'Claude Haiku 4.5')).toBeNull();
  });

  it('读取 Anthropic 官方标准价格表中的模型行', () => {
    const html = `
      <table>
        <thead><tr><th>Model</th><th>Base Input Tokens</th><th>5m Cache Writes</th><th>1h Cache Writes</th><th>Cache Hits & Refreshes</th><th>Output Tokens</th></tr></thead>
        <tbody>
          <tr><td>Claude Opus 5</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
          <tr><td>Claude Opus 4.8</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
        </tbody>
      </table>`;
    expect(parseOfficialPrices(html, 'anthropic', 'Claude Opus 4.8', 'Claude Opus 4.8')).toMatchObject({
      currency: 'USD', input: 5, cachedInput: 0.5, output: 25,
    });
  });

  it('不会把 Anthropic Batch 表格价格当成标准价格', () => {
    const html = `
      <h2>Batch processing</h2>
      <table><thead><tr><th>Model</th><th>Batch input</th><th>Batch output</th></tr></thead>
      <tbody><tr><td>Claude Opus 4.8</td><td>$2.50 / MTok</td><td>$12.50 / MTok</td></tr></tbody></table>`;
    expect(parseOfficialPrices(html, 'anthropic', 'Claude Opus 4.8', 'Claude Opus 4.8')).toBeNull();
  });
});
