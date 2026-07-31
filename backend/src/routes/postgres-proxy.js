const express = require('express');
const { randomUUID } = require('node:crypto');
const { extractUsage } = require('../utils/pricing-engine');
const { countGeneratedImages } = require('../utils/image-billing');
const {
  ImageRequestExecutor,
  createImageUploadMiddleware,
  imageFilesFromRequest,
} = require('../utils/image-request-executor');
const {
  UpstreamHttpError,
  executeJsonUpstream,
  executeMultipartUpstream,
  jsonEventsFromSnapshot,
  jsonFromSnapshot,
  writeSnapshot,
} = require('../modules/postgres-proxy/upstream');
const {
  PostgresProxyBillingPolicy,
  PostgresProxyRepository,
} = require('../modules/postgres-proxy/postgres-adapters');

function identityFromRequest(req) {
  const identity = req.apiIdentity || req.identity || {};
  return {
    ...identity,
    userId: identity.userId ?? req.userId ?? req.apiKey?.user_id,
    apiKeyId: identity.apiKeyId ?? req.apiKey?.id,
    routingGroupId: identity.routingGroupId ?? req.apiKey?.routing_group_id,
  };
}

function responseMetrics(snapshot, operation) {
  const document = jsonFromSnapshot(snapshot);
  const events = document === null ? jsonEventsFromSnapshot(snapshot) : [document];
  const usage = extractUsage({});
  let usageFound = false;
  let imageCount = 0;
  for (const event of events) {
    const payload = event?.response || event;
    const rawUsage = operation === 'anthropic_count_tokens'
      ? (Number.isFinite(Number(payload?.input_tokens)) ? { input_tokens: payload.input_tokens } : null)
      : payload?.usage || event?.usage || event?.message?.usage || event?.delta?.usage;
    if (rawUsage) {
      usageFound = true;
      const current = extractUsage(rawUsage);
      for (const key of Object.keys(usage)) usage[key] = Math.max(usage[key], current[key]);
    }
    imageCount = Math.max(imageCount, countGeneratedImages(payload || {}));
  }
  return {
    payload: document || events.at(-1)?.response || events.at(-1) || null,
    usage,
    usageFound,
    imageCount,
  };
}

function finishSnapshotResponse(res, snapshot) {
  if (!snapshot?.streamed) return writeSnapshot(res, snapshot);
  if (!res.writableEnded && !res.destroyed) res.end();
  return res;
}

function startStreamingResponse(res, snapshot) {
  for (const [name, value] of Object.entries(snapshot.headers || {})) res.setHeader(name, value);
  res.status(snapshot.status);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

async function writeStreamingChunk(res, chunk) {
  if (res.writableEnded || res.destroyed) {
    const error = new Error('Client disconnected during upstream streaming');
    error.code = 'CLIENT_DISCONNECTED';
    throw error;
  }
  if (res.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => {
      cleanup();
      const error = new Error('Client disconnected during upstream streaming');
      error.code = 'CLIENT_DISCONNECTED';
      reject(error);
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

function createPostgresProxyRouter({
  runtime,
  identity,
  authenticateApiKey = identity?.authenticateApiKey,
  repository: providedRepository,
  billingPolicy: providedBillingPolicy,
  fetchImpl = globalThis.fetch,
  requestIdFactory = randomUUID,
  upstreamTimeoutMs = 120_000,
} = {}) {
  if (runtime?.mode !== 'postgres_redis') throw new Error('PostgreSQL proxy requires postgres_redis runtime');
  if (typeof authenticateApiKey !== 'function') throw new Error('PostgreSQL proxy authentication is required');
  const repository = providedRepository
    || runtime.proxyRepository
    || new PostgresProxyRepository(runtime.pool);
  const billingPolicy = providedBillingPolicy
    || runtime.proxyBillingPolicy
    || new PostgresProxyBillingPolicy(runtime.pool);
  if (!repository?.listModels) throw new Error('PostgreSQL proxy repository is required');
  if (!billingPolicy?.quoteReservation || !billingPolicy?.quoteCharge) {
    throw new Error('PostgreSQL proxy billing policy is required');
  }
  if (typeof fetchImpl !== 'function') throw new Error('PostgreSQL proxy fetch implementation is required');

  const router = express.Router();
  const imageUpload = createImageUploadMiddleware();
  const imageRequestPreparer = new ImageRequestExecutor({
    postWithSafeFailover: async () => { throw new Error('prepare-only image executor'); },
  });
  router.use(authenticateApiKey);
  router.use(express.json({ limit: '20mb' }));

  function apiError(res, protocol, status, message, type, code) {
    if (protocol === 'anthropic') {
      return res.status(status).json({ type: 'error', error: { type, message, ...(code ? { code } : {}) } });
    }
    return res.status(status).json({ error: { message, type, ...(code ? { code } : {}) } });
  }

  function causeMatching(error, predicate) {
    const visited = new Set();
    let current = error;
    while (current && !visited.has(current)) {
      if (predicate(current)) return current;
      visited.add(current);
      current = current.cause;
    }
    return null;
  }

  function successLog({ requestId, identityContext, model, operation, execution, usage, imageCount, charge, reservation, startedAt }) {
    return {
      request_id: requestId,
      user_id: identityContext.userId,
      api_key_id: identityContext.apiKeyId,
      model_code: model,
      upstream_account_id: execution.selection.account.id,
      status: 'success',
      latency_ms: Date.now() - startedAt,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_cost: Number(charge.amount || 0),
      billing_mode: charge.billingMode || (imageCount > 0 ? 'image' : 'token'),
      billing_snapshot: {
        operation,
        image_count: imageCount,
        reservation: reservation.snapshot || {},
        charge: charge.snapshot || {},
        scheduler_post_processing_error: execution.postProcessingError?.code || null,
      },
    };
  }

  function pendingLog({ requestId, identityContext, model, operation, reason, startedAt }) {
    return {
      request_id: requestId,
      user_id: identityContext.userId,
      api_key_id: identityContext.apiKeyId,
      model_code: model,
      status: 'settlement_pending',
      latency_ms: Date.now() - startedAt,
      error_type: reason,
      error_message: 'Execution outcome requires reconciliation',
      billing_mode: operation.startsWith('image_') ? 'image' : 'token',
      billing_snapshot: { operation, reconciliation_reason: reason },
    };
  }

  function handleJsonOperation({ operation, capability, protocol, upstreamPath, prepareRequest }) {
    return async (req, res, next) => {
      const identityContext = identityFromRequest(req);
      let prepared;
      try {
        prepared = prepareRequest
          ? await prepareRequest(req)
          : { model: req.body?.model, billingRequest: req.body };
      } catch (error) {
        return apiError(res, protocol, Number(error.status || 400), error.message, error.type || 'invalid_request_error');
      }
      const billingRequest = prepared.billingRequest || req.body || {};
      const model = String(prepared.model || '').trim();
      if (!model) return apiError(res, protocol, 400, 'model is required', 'invalid_request_error');
      if (Array.isArray(identityContext.allowedModels) && !identityContext.allowedModels.includes(model)) {
        return apiError(res, protocol, 404, `Model ${model} is not available`, 'model_not_found');
      }
      const requestId = requestIdFactory();
      let reservedAmount = 0;
      const startedAt = Date.now();
      let reservation;
      try {
        reservation = await billingPolicy.quoteReservation({
          identity: identityContext,
          operation,
          model,
          request: billingRequest,
        });
        reservedAmount = Number(reservation.amount);
        const freeze = await runtime.usageSettlement.reserve({
          userId: identityContext.userId,
          apiKeyId: identityContext.apiKeyId,
          amount: reservedAmount,
          requestId,
        });
        reservedAmount = Number(freeze?.reserved ?? reservedAmount);

        const execution = await runtime.gatewayScheduler.executeWithFailover({
          groupId: identityContext.routingGroupId,
          model,
          protocol,
          capability,
          estimatedTokens: Number(reservation.estimatedTokens || 0),
        }, selection => {
          if (prepared.execute) return prepared.execute(selection);
          const shouldStream = billingRequest.stream === true
            && ['chat_completions', 'responses', 'anthropic_messages'].includes(operation);
          return executeJsonUpstream({
            fetchImpl,
            selection,
            secretBox: runtime.secretBox,
            path: upstreamPath,
            body: operation === 'chat_completions' && billingRequest.stream === true
              ? {
                ...billingRequest,
                stream_options: { ...billingRequest.stream_options, include_usage: true },
              }
              : billingRequest,
            requestHeaders: req.headers,
            timeoutMs: upstreamTimeoutMs,
            stream: shouldStream,
            onStreamStart: shouldStream ? snapshot => startStreamingResponse(res, snapshot) : undefined,
            onStreamChunk: shouldStream ? chunk => writeStreamingChunk(res, chunk) : undefined,
          });
        });

        const metrics = responseMetrics(execution.value, operation);
        const { payload, usage, imageCount } = metrics;
        const actualUsageKnown = operation.startsWith('image_')
          ? payload !== null
          : operation === 'anthropic_count_tokens'
            ? Number.isFinite(Number(payload?.input_tokens))
            : metrics.usageFound || imageCount > 0;
        if (!actualUsageKnown) {
          await runtime.usageSettlement.markPending({
            userId: identityContext.userId,
            reservedAmount,
            requestId,
            log: pendingLog({
              requestId, identityContext, model, operation, reason: 'usage_missing', startedAt,
            }),
          });
          reservedAmount = 0;
          if (!res.headersSent) res.setHeader('x-settlement-status', 'pending');
          return finishSnapshotResponse(res, execution.value);
        }

        const charge = await billingPolicy.quoteCharge({
          identity: identityContext,
          operation,
          model,
          request: billingRequest,
          usage,
          imageCount,
          selection: execution.selection,
          response: payload,
        });
        await runtime.usageSettlement.settle({
          userId: identityContext.userId,
          reservedAmount,
          chargeAmount: Number(charge.amount || 0),
          requestId,
          successLog: successLog({
            requestId, identityContext, model, operation, execution, usage,
            imageCount, charge, reservation, startedAt,
          }),
        });
        reservedAmount = 0;
        return finishSnapshotResponse(res, execution.value);
      } catch (error) {
        const upstreamHttpError = causeMatching(error, candidate => candidate instanceof UpstreamHttpError);
        if (reservedAmount > 0 && upstreamHttpError) {
          await runtime.usageSettlement.release({
            userId: identityContext.userId,
            reservedAmount,
            requestId,
            remark: `Upstream returned definitive HTTP ${upstreamHttpError.status}`,
          });
          reservedAmount = 0;
          return writeSnapshot(res, upstreamHttpError.response);
        }
        const uncertain = causeMatching(error, candidate => candidate.executionUncertain === true);
        if (reservedAmount > 0 && uncertain) {
          await runtime.usageSettlement.markPending({
            userId: identityContext.userId,
            reservedAmount,
            requestId,
            log: pendingLog({
              requestId, identityContext, model, operation, reason: 'upstream_state_unknown', startedAt,
            }),
          });
          reservedAmount = 0;
          if (res.headersSent) {
            if (!res.writableEnded && !res.destroyed) res.end();
            return res;
          }
          return apiError(
            res,
            protocol,
            502,
            'Upstream execution state is uncertain; the reservation is pending reconciliation',
            'settlement_pending',
          );
        }
        if (reservedAmount > 0 && ['redis_unavailable', 'no_account_available', 'account_capacity_exhausted']
          .includes(error.code)) {
          await runtime.usageSettlement.release({
            userId: identityContext.userId,
            reservedAmount,
            requestId,
            remark: 'Gateway scheduling did not start an upstream request',
          });
          reservedAmount = 0;
          if (error.code === 'redis_unavailable') {
            return apiError(
              res,
              protocol,
              503,
              'Gateway scheduler is temporarily unavailable',
              'service_unavailable',
              'redis_unavailable',
            );
          }
          return apiError(res, protocol, 503, 'No upstream account is currently available', 'no_channel', error.code);
        }
        if (reservedAmount > 0) {
          try {
            await runtime.usageSettlement.markPending({
              userId: identityContext.userId,
              reservedAmount,
              requestId,
              log: pendingLog({
                requestId, identityContext, model, operation, reason: 'settlement_failed', startedAt,
              }),
            });
            reservedAmount = 0;
          } catch (_pendingError) { /* reservation remains frozen for operator reconciliation */ }
        }
        if (res.headersSent) {
          if (!res.writableEnded && !res.destroyed) res.end();
          return res;
        }
        return next(error);
      }
    };
  }

  router.get('/models', async (req, res, next) => {
    try {
      const models = await repository.listModels(identityFromRequest(req));
      return res.json({ object: 'list', data: models });
    } catch (error) {
      return next(error);
    }
  });

  for (const operation of [
    { route: '/chat/completions', operation: 'chat_completions', capability: 'chat_completions', protocol: 'openai_compatible', upstreamPath: 'chat/completions' },
    { route: '/responses', operation: 'responses', capability: 'responses', protocol: 'openai_compatible', upstreamPath: 'responses' },
    { route: '/embeddings', operation: 'embeddings', capability: 'embeddings', protocol: 'openai_compatible', upstreamPath: 'embeddings' },
    { route: '/messages', operation: 'anthropic_messages', capability: 'anthropic_messages', protocol: 'anthropic', upstreamPath: 'messages' },
    { route: '/messages/count_tokens', operation: 'anthropic_count_tokens', capability: 'anthropic_count_tokens', protocol: 'anthropic', upstreamPath: 'messages/count_tokens' },
    { route: '/images/generations', operation: 'image_generations', capability: 'image_generations', protocol: 'openai_compatible', upstreamPath: 'images/generations' },
  ]) {
    router.post(operation.route, handleJsonOperation(operation));
  }

  for (const operation of [
    { route: '/images/edits', endpoint: 'images/edits', operation: 'image_edits', capability: 'image_edits' },
    { route: '/images/variations', endpoint: 'images/variations', operation: 'image_variations', capability: 'image_variations' },
    { route: '/images/transformations', endpoint: 'images/transformations', operation: 'image_transformations', capability: 'image_transformations' },
  ]) {
    router.post(operation.route, imageUpload, handleJsonOperation({
      ...operation,
      protocol: 'openai_compatible',
      upstreamPath: operation.endpoint,
      prepareRequest(req) {
        const files = imageFilesFromRequest(req);
        const prepared = imageRequestPreparer.prepare({
          endpoint: operation.endpoint,
          body: req.body,
          files,
        });
        const billingRequest = {
          ...req.body,
          input_image_count: files.images.length,
          has_mask: Boolean(files.mask),
        };
        return {
          model: req.body.model,
          billingRequest,
          execute(selection) {
            if (prepared.endpoint === 'responses') {
              return executeJsonUpstream({
                fetchImpl,
                selection,
                secretBox: runtime.secretBox,
                path: 'responses',
                body: prepared.body,
                requestHeaders: req.headers,
                timeoutMs: upstreamTimeoutMs,
              });
            }
            return executeMultipartUpstream({
              fetchImpl,
              selection,
              secretBox: runtime.secretBox,
              path: prepared.endpoint,
              body: prepared.body,
              files: prepared.files,
              requestHeaders: req.headers,
              timeoutMs: upstreamTimeoutMs,
            });
          },
        };
      },
    }));
  }

  return router;
}

module.exports = { createPostgresProxyRouter, identityFromRequest };
