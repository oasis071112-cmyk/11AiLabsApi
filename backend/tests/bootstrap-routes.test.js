import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import {
  createBootstrapRouter,
  createRuntimeBootstrapAuthenticate,
} from '../src/routes/bootstrap.js';
import { createPostgresIdentity } from '../src/modules/identity/index.js';

const servers = [];

async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

function dependencies(role = 'admin') {
  const dashboardReadModel = {
    userBootstrap: vi.fn(async userId => ({ user_id: userId, stats: { calls: 4 } })),
    userLogsOverview: vi.fn(async (userId, query) => ({ user_id: userId, query, data: [] })),
    adminBootstrap: vi.fn(async () => ({ today_calls: 19 })),
  };
  const controlPlane = {
    bootstrap: vi.fn(async () => ({ accounts: [{ id: 1, name: 'main' }] })),
    createAccount: vi.fn(async input => ({ account: { id: 2, name: input.name } })),
  };
  return {
    dashboardReadModel,
    controlPlane,
    authenticate(req, _res, next) { req.user = { id: 7, role }; next(); },
    requireUser(req, res, next) {
      return req.user.role === 'user' ? next() : res.status(403).json({ error: '仅普通用户可访问' });
    },
    requireAdmin: (...roles) => (req, res, next) => roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: '权限不足' }),
  };
}

describe('bootstrap aggregate routes', () => {
  it('serves user dashboard and logs overview through one aggregate endpoint each', async () => {
    const deps = dependencies('user');
    const baseUrl = await serve(createBootstrapRouter(deps));

    const dashboard = await fetch(`${baseUrl}/api/user/dashboard/bootstrap`).then(response => response.json());
    const logs = await fetch(`${baseUrl}/api/user/logs/overview?limit=25&model=gpt-image-2`).then(response => response.json());

    expect(dashboard).toEqual({ user_id: 7, stats: { calls: 4 } });
    expect(logs).toMatchObject({ user_id: 7, data: [], query: { limit: '25', model: 'gpt-image-2' } });
    expect(deps.dashboardReadModel.userBootstrap).toHaveBeenCalledWith(7);
  });

  it('rejects staff tokens on user aggregate endpoints', async () => {
    const deps = dependencies('admin');
    const baseUrl = await serve(createBootstrapRouter(deps));
    expect((await fetch(`${baseUrl}/api/user/dashboard/bootstrap`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/user/logs/overview`)).status).toBe(403);
    expect(deps.dashboardReadModel.userBootstrap).not.toHaveBeenCalled();
  });

  it('serves admin dashboard and sanitized control-plane bootstrap', async () => {
    const deps = dependencies('operator');
    const baseUrl = await serve(createBootstrapRouter(deps));

    const dashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard/bootstrap`);
    const controlResponse = await fetch(`${baseUrl}/api/admin/control-plane/bootstrap`);

    expect(dashboardResponse.status).toBe(200);
    expect(await dashboardResponse.json()).toEqual({ today_calls: 19 });
    expect(controlResponse.status).toBe(200);
    expect(await controlResponse.json()).toEqual({ accounts: [{ id: 1, name: 'main' }] });
  });

  it('records a sanitized warning when the admin dashboard read is slow', async () => {
    const deps = dependencies('admin');
    const logger = { warn: vi.fn() };
    const timestamps = [1_000, 3_105];
    const baseUrl = await serve(createBootstrapRouter({
      ...deps,
      logger,
      clock: () => timestamps.shift(),
      slowRequestMs: 1_000,
    }));

    expect((await fetch(`${baseUrl}/api/admin/dashboard/bootstrap`)).status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith('管理概览查询耗时较长', {
      duration_ms: 2_105,
      route: '/api/admin/dashboard/bootstrap',
    });
  });

  it('allows only administrators to create an upstream account', async () => {
    const forbidden = dependencies('operator');
    const forbiddenUrl = await serve(createBootstrapRouter(forbidden));
    const forbiddenResponse = await fetch(`${forbiddenUrl}/api/admin/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
    });
    expect(forbiddenResponse.status).toBe(403);

    const allowed = dependencies('admin');
    const allowedUrl = await serve(createBootstrapRouter(allowed));
    const allowedResponse = await fetch(`${allowedUrl}/api/admin/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'new account' }),
    });
    expect(allowedResponse.status).toBe(201);
    expect(await allowedResponse.json()).toEqual({ account: { id: 2, name: 'new account' } });
  });

  it('rechecks PostgreSQL staff status and role before bootstrap reads or mutations', async () => {
    const staff = { id: 41, username: 'bootstrap-admin', role: 'admin', status: 'active' };
    const pool = {
      query: vi.fn(async (sql, values) => {
        if (!String(sql).includes('FROM staff_users')) throw new Error(`unexpected query: ${sql}`);
        return { rows: String(values[0]) === String(staff.id) ? [{ ...staff }] : [] };
      }),
    };
    const identity = createPostgresIdentity({
      pool,
      jwtSecret: 'bootstrap-runtime-test-secret-32-bytes',
      bcrypt: { compare: vi.fn(), hash: vi.fn() },
    });
    const runtime = { mode: 'postgres_redis', identity };
    const deps = dependencies('admin');
    deps.authenticate = createRuntimeBootstrapAuthenticate({
      getRuntime: () => runtime,
      legacyAuthenticate: deps.authenticate,
    });
    const baseUrl = await serve(createBootstrapRouter(deps));
    const token = identity.generateToken(staff);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const allowed = await fetch(`${baseUrl}/api/admin/control-plane/bootstrap`, { headers });
    expect(allowed.status).toBe(200);

    staff.status = 'disabled';
    const disabled = await fetch(`${baseUrl}/api/admin/control-plane/bootstrap`, { headers });
    expect(disabled.status).toBe(401);

    staff.status = 'active';
    staff.role = 'operator';
    const demoted = await fetch(`${baseUrl}/api/admin/accounts`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'must-not-be-created' }),
    });
    expect(demoted.status).toBe(401);
    expect(deps.controlPlane.createAccount).not.toHaveBeenCalled();
  });
});
