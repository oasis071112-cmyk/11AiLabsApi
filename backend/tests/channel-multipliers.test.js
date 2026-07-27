import { describe, expect, it } from 'vitest';
import {
  resolveChannelMultipliers,
  resolveEffectiveMultiplierPolicy,
} from '../src/utils/channel-multipliers.js';

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

  it('用户专属倍率优先于渠道倍率，渠道未配置的维度按平台模型和平台全局顺序回退', () => {
    expect(resolveEffectiveMultiplierPolicy({
      userRule: {
        billing_multiplier_input: 0.2,
        billing_multiplier_output: 0.25,
        billing_multiplier_image: 0.3,
      },
      channel: {
        billing_multiplier_input: 0.35,
        billing_multiplier_output: null,
        billing_multiplier_image: 0.4,
      },
      platformModelRule: {
        billing_multiplier_input: 0.5,
        billing_multiplier_output: 0.55,
        billing_multiplier_image: null,
      },
      platformDefaultRule: {
        billing_multiplier_input: 0.6,
        billing_multiplier_output: 0.65,
        billing_multiplier_image: 0.7,
      },
      model: {
        billing_multiplier_input: 0.8,
        billing_multiplier_output: 0.85,
        billing_multiplier_image: 0.9,
      },
    })).toEqual({
      multipliers: { input: 0.2, output: 0.25, image: 0.3 },
      sources: { input: 'user', output: 'user', image: 'user' },
    });
  });

  it('没有用户专属倍率时使用渠道倍率，并记录每个计费维度的来源', () => {
    expect(resolveEffectiveMultiplierPolicy({
      channel: {
        billing_multiplier_input: null,
        billing_multiplier_output: 0.35,
        billing_multiplier_image: 0.4,
      },
      platformModelRule: {
        billing_multiplier_input: 0.5,
        billing_multiplier_output: 0.55,
      },
      platformDefaultRule: {
        billing_multiplier_input: 0.6,
        billing_multiplier_output: 0.65,
        billing_multiplier_image: 0.7,
      },
      model: {
        billing_multiplier_input: 0.8,
        billing_multiplier_output: 0.85,
        billing_multiplier_image: 0.9,
      },
    })).toEqual({
      multipliers: { input: 0.5, output: 0.35, image: 0.4 },
      sources: { input: 'platform_model', output: 'channel', image: 'channel' },
    });
  });
});
