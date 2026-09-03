import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCodexCompatibilityRouter } = require('../src/routes/codex-compat.js');
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

async function serve() {
  const app = express();
  app.use(express.json());
  const canonical = express.Router();
  canonical.post('/responses', (req, res) => res.json({ endpoint: req.path, body: req.body }));
  canonical.post('/images/generations', (req, res) => res.json({ endpoint: req.path, body: req.body }));
  canonical.post('/images/edits', (req, res) => res.json({ endpoint: req.path, body: req.body }));
  canonical.post('/chat/completions', (_req, res) => res.json({ endpoint: 'unexpected' }));
  app.use('/v1', canonical);
  app.use(createCodexCompatibilityRouter({ proxyRouter: canonical }));
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('Codex root API compatibility', () => {
  it.each(['/responses', '/images/generations', '/images/edits'])(
    'routes POST %s through the canonical proxy router without changing the request body',
    async path => {
      const baseUrl = await serve();
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-2', marker: path }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        endpoint: path,
        body: { model: 'gpt-image-2', marker: path },
      });
    },
  );

  it('does not expose unrelated proxy endpoints at the root', async () => {
    const baseUrl = await serve();
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
