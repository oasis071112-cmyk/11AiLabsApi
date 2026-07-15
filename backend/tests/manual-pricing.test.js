import axios from 'axios';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDatabase, initDatabase } from '../src/database/init.js';
import { syncOfficialPricing } from '../src/utils/pricing-sync.js';

describe('手动官方价格锁定', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('手动模式价格不会被定时官方同步覆盖', async () => {
    const db = getDatabase();
    const modelCode = `manual-price-${Date.now()}`;
    db.prepare(`
      INSERT INTO models (
        model_code,model_name,status,official_provider,official_model_id,
        official_currency,official_input_price,official_cached_input_price,
        official_output_price,official_unit_tokens,official_pricing_mode
      ) VALUES (?,?,'active','openai','gpt-5.5','USD',1.25,0.25,9.5,1000000,'manual')
    `).run(modelCode, '手动价格模型');
    const getSpy = vi.spyOn(axios, 'get').mockRejectedValue(new Error('手动模型不应访问网络'));

    const result = await syncOfficialPricing(db);

    const model = db.prepare(`
      SELECT official_pricing_mode,official_input_price,official_cached_input_price,
             official_output_price,official_currency
      FROM models WHERE model_code=?
    `).get(modelCode);
    expect(model).toMatchObject({
      official_pricing_mode: 'manual',
      official_input_price: 1.25,
      official_cached_input_price: 0.25,
      official_output_price: 9.5,
      official_currency: 'USD'
    });
    expect(result.details.some(detail => detail.model === modelCode)).toBe(false);
    expect(getSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
  });
});
