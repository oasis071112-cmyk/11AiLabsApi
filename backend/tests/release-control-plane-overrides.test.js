import { describe, expect, it, vi } from 'vitest';
import {
  RELEASE_OVERRIDE_PROFILE,
  applyReleaseControlPlaneOverrides,
  releaseOverridePlan,
} from '../scripts/apply-release-control-plane-overrides.js';
import { withTransaction } from '../src/infrastructure/postgres.js';

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

  it('rolls back account and model writes when post-update verification fails', async () => {
    const initialState = targetRow();
    let state = structuredClone(initialState);
    let transactionSnapshot = null;
    const commands = [];
    const client = {
      release: vi.fn(),
      query: vi.fn(async (sql, values = []) => {
        const statement = String(sql).trim();
        commands.push(statement);
        if (statement === 'BEGIN') {
          transactionSnapshot = structuredClone(state);
          return { rows: [], rowCount: 0 };
        }
        if (statement === 'ROLLBACK') {
          state = transactionSnapshot;
          return { rows: [], rowCount: 0 };
        }
        if (statement === 'COMMIT') return { rows: [], rowCount: 0 };
        if (String(sql).includes('SELECT ua.account_key')) {
          return { rows: [structuredClone(state)] };
        }
        if (String(sql).includes('UPDATE upstream_accounts')) {
          state.capabilities = JSON.parse(values[1]);
          return { rows: [], rowCount: 1 };
        }
        if (String(sql).includes('UPDATE account_models')) {
          state.supports_image_input = true;
          state.mapping_image_prices = { '1K': null, '2K': null, '4K': null };
          return { rows: [], rowCount: 1 };
        }
        if (String(sql).includes('UPDATE models')) {
          state.official_currency = 'USD';
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const pool = { connect: vi.fn(async () => client) };

    await expect(withTransaction(pool, activeClient => applyReleaseControlPlaneOverrides(activeClient)))
      .rejects.toThrow('official_image_prices');
    expect(state).toEqual(initialState);
    expect(commands).toContain('ROLLBACK');
    expect(commands).not.toContain('COMMIT');
    expect(commands.some(sql => sql.includes('INSERT INTO audit_logs'))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
