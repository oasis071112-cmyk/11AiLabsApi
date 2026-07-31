import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createSecretBox } = require('../src/infrastructure/versioned-secret.js');

describe('versioned secret seam', () => {
  it('seals with the active version and opens after key rotation', () => {
    const oldKey = Buffer.alloc(32, 7);
    const newKey = Buffer.alloc(32, 8);
    const writer = createSecretBox({ activeVersion: 'v2', keys: { v1: oldKey, v2: newKey } });
    const envelope = writer.seal('upstream-api-key', { aad: 'upstream_accounts:primary' });

    expect(envelope).toMatch(/^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain('upstream-api-key');
    expect(writer.open(envelope, { aad: 'upstream_accounts:primary' })).toBe('upstream-api-key');

    const reader = createSecretBox({ activeVersion: 'v2', keys: { v1: oldKey, v2: newKey } });
    expect(reader.open(envelope, { aad: 'upstream_accounts:primary' })).toBe('upstream-api-key');
    expect(() => reader.open(envelope, { aad: 'upstream_accounts:secondary' })).toThrow('认证失败');
  });
});
