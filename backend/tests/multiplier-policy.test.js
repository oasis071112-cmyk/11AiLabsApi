import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveMultiplierPolicy,
} from '../src/utils/multiplier-policy.js';

describe('用户扣费倍率优先级', () => {
  it('用户专属倍率优先于路由分组倍率', () => {
    expect(resolveEffectiveMultiplierPolicy({
      userRule: {
        billing_multiplier_input: 0.2,
        billing_multiplier_output: 0.25,
        billing_multiplier_image: 0.3,
      },
      routingGroup: {
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

  it('路由分组只覆盖已配置维度，其余按全局倍率回退', () => {
    expect(resolveEffectiveMultiplierPolicy({
      routingGroup: {
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
      sources: { input: 'global', output: 'routing_group', image: 'routing_group' },
    });
  });

  it('未配置用户、路由分组或全局倍率时以 1 倍兜底', () => {
    expect(resolveEffectiveMultiplierPolicy({
      userRule: {
        billing_multiplier_input: 0,
        billing_multiplier_output: null,
        billing_multiplier_image: 'invalid',
      },
      routingGroup: {},
      platformModelRule: {},
      platformDefaultRule: {},
      model: {},
    })).toEqual({
      multipliers: { input: 1, output: 1, image: 1 },
      sources: { input: 'system_default', output: 'system_default', image: 'system_default' },
    });
  });
});
