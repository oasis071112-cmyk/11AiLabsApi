import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { deriveUserDeductionUsd } = require('../src/utils/admin-user-deduction.js');

describe('deriveUserDeductionUsd', () => {
  it.each([
    ['Token', { status: 'success', total_cost: '14', billing_snapshot: { charge: { mode: 'token', currency: 'USD', usd_cny_rate: 7 } } }, 2],
    ['每请求', { status: 'success', total_cost: 3.6, billing_snapshot: { charge: { mode: 'per_request', currency: 'USD', usd_cny_rate: 7.2 } } }, 0.5],
    ['图片', { status: 'success', total_cost: 2.1, billing_snapshot: { charge: { mode: 'image', currency: 'USD', usd_cny_rate: 7 } } }, 0.3],
  ])('derives the %s user deduction from the settled points and request-time rate', (_mode, log, expected) => {
    expect(deriveUserDeductionUsd(log)).toBeCloseTo(expected, 12);
  });

  it('supports the legacy flat USD pricing snapshot', () => {
    expect(deriveUserDeductionUsd({
      status: 'success', total_cost: 7, official_currency: 'USD', usd_cny_rate: 7,
    })).toBe(1);
  });

  it('returns zero for a successful zero-cost call with a valid USD snapshot', () => {
    expect(deriveUserDeductionUsd({
      status: 'success', total_cost: 0, billing_snapshot: { charge: { currency: 'USD', usd_cny_rate: 7 } },
    })).toBe(0);
  });

  it('accepts a multi-tier image charge when every persisted tier is USD', () => {
    expect(deriveUserDeductionUsd({
      status: 'success',
      total_cost: 7,
      billing_snapshot: {
        charge: {
          currency: 'mixed',
          usd_cny_rate: 7,
          tier_charges: {
            '1K': { currency: 'USD' },
            '2K': { currency: 'USD' },
          },
        },
      },
    })).toBe(1);
  });

  it('returns USD for a failed request that was automatically partial-settled', () => {
    expect(deriveUserDeductionUsd({
      status: 'failed',
      total_cost: 0.7,
      billing_snapshot: {
        charge: { currency: 'USD', usd_cny_rate: 7 },
        settlement: { outcome: 'partial_settled' },
      },
    })).toBeCloseTo(0.1, 12);
  });

  it.each([
    ['failed call', { status: 'failed', total_cost: 7, billing_snapshot: { currency: 'USD', usd_cny_rate: 7 } }],
    ['pending settlement', { status: 'settlement_pending', total_cost: 0, billing_snapshot: { currency: 'USD', usd_cny_rate: 7 } }],
    ['missing snapshot', { status: 'success', total_cost: 7 }],
    ['invalid rate', { status: 'success', total_cost: 7, billing_snapshot: { currency: 'USD', usd_cny_rate: 0 } }],
    ['non-USD snapshot', { status: 'success', total_cost: 7, billing_snapshot: { currency: 'CNY', usd_cny_rate: 7 } }],
  ])('does not report a deduction for a %s', (_case, log) => {
    expect(deriveUserDeductionUsd(log)).toBeNull();
  });
});
