import { describe, expect, it, vi } from 'vitest';
import {
  RELEASE_OVERRIDE_PROFILE,
  applyReleaseControlPlaneOverrides,
  releaseOverridePlan,
} from '../scripts/apply-release-control-plane-overrides.js';

const existingCapabilities = ['chat_completions', 'embeddings', 'image_generations', 'responses'];
const effectiveCapabilities = [...existingCapabilities, 'image_edits'];
const imagePricesUsd = { '1K': 0.031, '2K': 0.0465, '4K': 0.062 };

function targetRow(overrides = {}) {
  return {
    account_key: 'Uozi-openai',
    capabilities: existingCapabilities,
    supports_image_input: true,
    mapping_image_prices: { '1K': null, '2K': null, '4K': null },
    official_currency: 'USD',
    official_image_prices: { '1K': 0.2, '2K': 0.2, '4K': 0.2 },
    ...overrides,
  };
}

describe('release control-plane overrides', () => {
  it('declares the active image account, additive capability, and approved tier prices', () => {
    expect(releaseOverridePlan()).toEqual({
      profile: RELEASE_OVERRIDE_PROFILE,
      accountKey: 'Uozi-openai',
      modelCode: 'gpt-image-2',
      requiredCapabilities: ['image_edits'],
      supportsImageInput: true,
      currency: 'USD',
      imagePricesUsd,
    });
  });

  it('preserves existing capabilities, clears account price overrides, and audits verified defaults', async () => {
    const queries = [];
    let readCount = 0;
    const client = {
      query: vi.fn(async (sql, values = []) => {
        queries.push({ sql: String(sql), values });
        if (String(sql).includes('SELECT ua.account_key')) {
          readCount += 1;
          return { rows: [readCount === 1 ? targetRow() : targetRow({
            capabilities: effectiveCapabilities,
            official_image_prices: imagePricesUsd,
          })] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await applyReleaseControlPlaneOverrides(client, { actor: 'release-test' });

    expect(result).toMatchObject({ verified: true, profile: RELEASE_OVERRIDE_PROFILE });
    const accountUpdate = queries.find(item => item.sql.includes('UPDATE upstream_accounts'));
    expect(JSON.parse(accountUpdate.values[1])).toEqual(effectiveCapabilities);
    const mappingUpdate = queries.find(item => item.sql.includes('UPDATE account_models'));
    expect(mappingUpdate.sql).toContain("- 'image_price_1k'");
    expect(mappingUpdate.sql).toContain("- 'image_price_2k'");
    expect(mappingUpdate.sql).toContain("- 'image_price_4k'");
    const modelUpdate = queries.find(item => item.sql.includes('UPDATE models'));
    expect(JSON.parse(modelUpdate.values[1])).toEqual(imagePricesUsd);
    expect(queries.some(item => item.sql.includes('INSERT INTO audit_logs'))).toBe(true);
    expect(JSON.stringify(queries)).not.toContain('Uozi-image2');
  });

  it('does not write an audit record when post-update verification fails', async () => {
    let readCount = 0;
    const client = {
      query: vi.fn(async sql => {
        if (String(sql).includes('SELECT ua.account_key')) {
          readCount += 1;
          return { rows: [targetRow({
            capabilities: readCount === 1 ? existingCapabilities : effectiveCapabilities,
          })] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    await expect(applyReleaseControlPlaneOverrides(client)).rejects.toThrow('official_image_prices');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_logs'))).toBe(false);
  });
});
