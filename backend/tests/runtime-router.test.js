import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRuntimeRouter } = require('../src/routes/runtime-router.js');
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

async function serve(mode, postgresRouter) {
  const app = express();
  app.locals.runtime = { mode };
  const legacy = express.Router().get('/probe', (_req, res) => res.json({ runtime: 'legacy' }));
  app.use('/api', createRuntimeRouter({
    legacyRouter: legacy,
    getPostgresRouter: () => postgresRouter,
  }));
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}/api/probe`;
}

describe('runtime router boundary', () => {
  it('uses legacy routes only in explicit SQL.js rollback mode', async () => {
    const postgres = express.Router().get('/probe', (_req, res) => res.json({ runtime: 'postgres' }));
    const url = await serve('legacy_sqljs', postgres);
    expect(await fetch(url).then(response => response.json())).toEqual({ runtime: 'legacy' });
  });

  it('never falls through to SQL.js when PostgreSQL mode is selected', async () => {
    const url = await serve('postgres_redis', null);
    const response = await fetch(url);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'PostgreSQL route is not ready', code: 'POSTGRES_ROUTE_NOT_READY' });
  });

  it('uses the PostgreSQL route once its runtime dependencies are ready', async () => {
    const postgres = express.Router().get('/probe', (_req, res) => res.json({ runtime: 'postgres' }));
    const url = await serve('postgres_redis', postgres);
    expect(await fetch(url).then(response => response.json())).toEqual({ runtime: 'postgres' });
  });
});
