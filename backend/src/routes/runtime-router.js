function createRuntimeRouter({ legacyRouter, getPostgresRouter }) {
  if (typeof legacyRouter !== 'function') throw new TypeError('legacyRouter is required');
  if (typeof getPostgresRouter !== 'function') throw new TypeError('getPostgresRouter is required');

  return function runtimeRouter(req, res, next) {
    const mode = req.app?.locals?.runtime?.mode;
    if (mode !== 'postgres_redis') return legacyRouter(req, res, next);
    const postgresRouter = getPostgresRouter();
    if (typeof postgresRouter !== 'function') {
      return res.status(503).json({
        error: 'PostgreSQL route is not ready',
        code: 'POSTGRES_ROUTE_NOT_READY',
      });
    }
    return postgresRouter(req, res, next);
  };
}

module.exports = { createRuntimeRouter };
