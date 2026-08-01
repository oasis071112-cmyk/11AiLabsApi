import { describe, expect, it, vi } from 'vitest';
import {
  RELEASE_OVERRIDE_PROFILE,
  applyReleaseControlPlaneOverrides,
  releaseOverridePlan,
} from '../scripts/apply-release-control-plane-overrides.js';

describe('release control-plane overrides', () => {
  it('declares only the approved gpt-image-2 capability and flat price exceptions', () => {
    expect(releaseOverridePlan()).toEqual({
      profile: RELEASE_OVERRIDE_PROFILE,
      accountKey: 'Uozi-image2',
      modelCode: 'gpt-image-2',
      capabilities: ['image_generations', 'image_edits'],
      supportsImageInput: true,
      currency: 'USD',
      imagePricesUsd: { '1K': 0.2, '2K': 0.2, '4K': 0.2 },
    });
  });

  it('applies and verifies the approved exceptions in one transaction with an audit record', async () => {
    const queries = [];
    const client = {
      query: vi.fn(async (sql, values = []) => {
        queries.push({ sql: String(sql), values });
        if (String(sql).includes('SELECT ua.account_key')) {
          return {
            rows: [{
              account_key: 'Uozi-image2',
              capabilities: ['image_generations', 'image_edits'],
              supports_image_input: true,
              official_currency: 'USD',
              official_image_prices: { '1K': 0.2, '2K': 0.2, '4K': 0.2 },
            }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await applyReleaseControlPlaneOverrides(client, { actor: 'release-test' });

    expect(result).toMatchObject({ verified: true, profile: RELEASE_OVERRIDE_PROFILE });
    expect(queries.some(item => item.sql.includes('UPDATE upstream_accounts'))).toBe(true);
    expect(queries.some(item => item.sql.includes('UPDATE account_models'))).toBe(true);
    expect(queries.some(item => item.sql.includes('UPDATE models'))).toBe(true);
    expect(queries.some(item => item.sql.includes('INSERT INTO audit_logs'))).toBe(true);
    expect(JSON.stringify(queries)).not.toContain('image_variations');
    expect(JSON.stringify(queries)).not.toContain('image_transformations');
    expect(JSON.stringify(queries)).not.toContain('responses');
  });
});
