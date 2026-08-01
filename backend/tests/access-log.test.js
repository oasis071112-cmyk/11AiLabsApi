import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldSkipAccessLog } = require('../src/utils/access-log.js');

describe('production access log privacy', () => {
  it('skips EasyPay callback URLs so signatures and trade fields are never persisted', () => {
    expect(shouldSkipAccessLog({ path: '/api/payment/easypay/notify' })).toBe(true);
    expect(shouldSkipAccessLog({ originalUrl: '/api/payment/easypay/notify?sign=secret&trade_no=123' })).toBe(true);
    expect(shouldSkipAccessLog({ path: '/api/ready' })).toBe(false);
  });
});
