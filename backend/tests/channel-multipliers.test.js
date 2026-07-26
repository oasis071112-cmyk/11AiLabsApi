import { describe, expect, it } from 'vitest';
import { resolveChannelMultipliers } from '../src/utils/channel-multipliers.js';

describe('渠道计费倍率解析', () => {
  it('渠道只覆盖已配置的倍率，其余字段保持原有全局规则', () => {
    expect(resolveChannelMultipliers({
      billing_multiplier_input: 1.25,
      billing_multiplier_output: null,
      billing_multiplier_image: '',
    }, { input: 0.8, output: 0.9, image: 1.1 })).toEqual({
      input: 1.25,
      output: 0.9,
      image: 1.1,
    });
  });

  it('渠道为空或含历史无效值时完整回退原有全局规则', () => {
    expect(resolveChannelMultipliers({
      billing_multiplier_input: 0,
      billing_multiplier_output: -1,
      billing_multiplier_image: 'not-a-number',
    }, { input: 0.8, output: 0.9, image: 1.1 })).toEqual({
      input: 0.8,
      output: 0.9,
      image: 1.1,
    });
  });
});
