import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const { resolveLoadConfig } = require('../load/safety.js');

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('performance and load delivery contract', () => {
  it('defaults to a localhost mock and blocks external load targets without an explicit override', () => {
    expect(resolveLoadConfig({})).toMatchObject({ target: 'http://127.0.0.1:4010', isLocalTarget: true });
    expect(() => resolveLoadConfig({ LOAD_TARGET: 'https://upstream.example' })).toThrow(/ALLOW_EXTERNAL_LOAD_TARGET=true/);
    expect(resolveLoadConfig({ LOAD_TARGET: 'https://upstream.example', ALLOW_EXTERNAL_LOAD_TARGET: 'true' }))
      .toMatchObject({ target: 'https://upstream.example', isLocalTarget: false });
  });

  it('ships mock-only chat, capacity, 429 and failover scenarios without embedded keys or real upstream calls', () => {
    const mock = read('backend/load/mock-upstream.js');
    const scenarios = read('backend/load/autocannon-scenarios.js');
    const runner = read('backend/load/run-autocannon.js');
    const k6 = read('backend/load/k6-scenarios.js');

    expect(mock).toContain('http.createServer');
    expect(mock).not.toMatch(/\b(fetch|axios|https\.request)\s*\(/);
    for (const name of ['chat', 'capacity', 'rate_limit_failover']) expect(scenarios).toContain(name);
    expect(runner).toContain("require('autocannon')");
    expect(k6).toContain('__ENV.LOAD_TARGET');
    expect(k6).toContain('rateLimitFailover');
    expect(`${mock}\n${scenarios}\n${runner}\n${k6}`).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('checks first-paint bootstrap budgeting, deferred charts, empty states and stale-filter protection without browsing', () => {
    const check = read('frontend/scripts/check-first-paint-budget.mjs');
    const docs = read('docs/performance-validation.md');

    expect(check).toContain('createRequestCoordinator');
    expect(check).toContain('defineAsyncComponent');
    expect(check).toContain('IntersectionObserver');
    expect(check).toContain('bootstrap');
    expect(check).toContain('stale');
    expect(docs).toContain('1 秒');
    expect(docs).toContain('LOAD_TARGET');
    expect(docs).toContain('ALLOW_EXTERNAL_LOAD_TARGET=true');
  });
});
