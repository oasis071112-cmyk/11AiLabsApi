const express = require('express');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createRuntimeBootstrapAuthenticate({ getRuntime, legacyAuthenticate } = {}) {
  if (typeof getRuntime !== 'function') throw new TypeError('bootstrap runtime getter is required');
  if (typeof legacyAuthenticate !== 'function') throw new TypeError('legacy bootstrap authentication is required');
  return function runtimeBootstrapAuthenticate(req, res, next) {
    const runtime = getRuntime();
    const authenticate = runtime?.mode === 'postgres_redis'
      ? runtime.identity?.authenticate
      : legacyAuthenticate;
    if (typeof authenticate !== 'function') {
      return res.status(503).json({ error: 'Bootstrap authentication is not ready', code: 'AUTH_NOT_READY' });
    }
    return authenticate(req, res, next);
  };
}

function createBootstrapRouter({
  authenticate,
  requireUser,
  requireAdmin,
  dashboardReadModel,
  controlPlane,
  logger = console,
  clock = Date.now,
  slowRequestMs = 1_000,
}) {
  if (!authenticate || !requireUser || !requireAdmin || !dashboardReadModel || !controlPlane) {
    throw new Error('bootstrap routes require authentication, read model, and control plane services');
  }
  const router = express.Router();

  router.get('/user/dashboard/bootstrap', authenticate, requireUser, asyncRoute(async (req, res) => {
    res.json(await dashboardReadModel.userBootstrap(req.user.id));
  }));

  router.get('/user/logs/overview', authenticate, requireUser, asyncRoute(async (req, res) => {
    res.json(await dashboardReadModel.userLogsOverview(req.user.id, req.query));
  }));

  router.get(
    '/admin/dashboard/bootstrap',
    authenticate,
    requireAdmin('admin', 'operator', 'finance'),
    asyncRoute(async (_req, res) => {
      const startedAt = clock();
      try {
        return res.json(await dashboardReadModel.adminBootstrap());
      } finally {
        const durationMs = Math.max(0, clock() - startedAt);
        if (durationMs >= slowRequestMs) {
          logger.warn?.('管理概览查询耗时较长', {
            duration_ms: durationMs,
            route: '/api/admin/dashboard/bootstrap',
          });
        }
      }
    }),
  );

  router.get(
    '/admin/control-plane/bootstrap',
    authenticate,
    requireAdmin('admin', 'operator'),
    asyncRoute(async (_req, res) => res.json(await controlPlane.bootstrap())),
  );

  router.post(
    '/admin/accounts',
    authenticate,
    requireAdmin('admin'),
    asyncRoute(async (req, res) => {
      const result = await controlPlane.createAccount(req.body || {}, req.user);
      res.status(201).json(result);
    }),
  );

  return router;
}

module.exports = { asyncRoute, createBootstrapRouter, createRuntimeBootstrapAuthenticate };
