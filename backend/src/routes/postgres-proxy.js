const express = require('express');
const { randomUUID } = require('node:crypto');
const { extractUsage, mergeUsage } = require('../utils/pricing-engine');
const { countGeneratedImages, generatedImageOutputSizes } = require('../utils/image-billing');
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

function createResponseMetricsAccumulator(operation) {
  let usage = extractUsage({});
  let usageFound = false;
  let imageCount = 0;
  let resultPayload = null;
  const observe = event => {
    if (!event || typeof event !== 'object') return;
    const eventPayload = event?.response || event;
    const rawUsage = operation === 'anthropic_count_tokens'
      ? (Number.isFinite(Number(eventPayload?.input_tokens)) ? { input_tokens: eventPayload.input_tokens } : null)
      : eventPayload?.usage || event?.usage || event?.message?.usage || event?.delta?.usage;
    if (rawUsage) {
      usageFound = true;
      usage = mergeUsage(usage, rawUsage, {
        cacheTokensAreAdditional: operation === 'anthropic_messages',
      });
    }
    imageCount = Math.max(imageCount, countGeneratedImages(eventPayload || {}));
    if (event?.response || Object.keys(event).length > 0) {
      // Preserve the last complete upstream event as response context for pricing.
      resultPayload = eventPayload;
    }
  };
  return {
    observe,
    result(fallbackPayload = null) {
      return { payload: resultPayload || fallbackPayload, usage, usageFound, imageCount };
    },
  };
}

function responseMetrics(snapshot, operation) {
  const document = jsonFromSnapshot(snapshot);
  const events = document === null ? jsonEventsFromSnapshot(snapshot) : [document];
  const accumulator = createResponseMetricsAccumulator(operation);
  for (const event of events) {
    accumulator.observe(event);
  }
  return accumulator.result(document || events.at(-1)?.response || events.at(-1) || null);
}

function retryablePricingContext({ identity, operation, model, request, usage, imageCount, selection, response }) {
  const outputSizes = generatedImageOutputSizes(response || {});
  return {
    identity: { userId: identity.userId, routingGroupId: identity.routingGroupId },
    operation,
    model,
    request: {
      service_tier: request?.service_tier,
      size: request?.size,
      n: request?.n,
      tools: Array.isArray(request?.tools)
        ? request.tools.map(tool => ({ type: tool?.type, model: tool?.model }))
        : undefined,
    },
    usage,
    imageCount,
    selection: {
      routingGroupId: selection?.routingGroupId,
      account: {
        modelMappings: (selection?.account?.modelMappings || []).map(mapping => ({
          model: mapping?.model,
          configuration: mapping?.configuration,
        })),
      },
    },
    response: outputSizes.length ? { data: outputSizes.map(size => ({ size })) } : null,
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
  streamTimeouts = {
    firstByteTimeoutMs: 120_000,
    idleTimeoutMs: 120_000,
    totalTimeoutMs: 900_000,
  },
  leaseRenewIntervalMs = 30_000,
  now = Date.now,
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

  function apiError(res, protocol, status, message, type, code, details) {
    if (protocol === 'anthropic') {
      return res.status(status).json({ type: 'error', error: { type, message, ...(code ? { code } : {}), ...(details ? { details } : {}) } });
    }
    return res.status(status).json({ error: { message, type, ...(code ? { code } : {}), ...(details ? { details } : {}) } });
  }

  function sanitizedCapacity(error) {
    const allowedReasons = new Set(['concurrency', 'rpm', 'tpm', 'cooldown']);
    const rejections = Array.isArray(error?.details?.rejections) ? error.details.rejections : [];
    const reasons = [...new Set(rejections.map(item => item?.reason).filter(reason => allowedReasons.has(reason)))];
    const retryAfterMs = rejections
      .map(item => Number(item?.retryAfterMs))
      .filter(value => Number.isFinite(value) && value > 0);
    const retryAfterSeconds = reasons.includes('concurrency')
      ? 1
      : Math.max(1, Math.ceil((retryAfterMs.length ? Math.min(...retryAfterMs) : 1_000) / 1_000));
    return { reasons, retryAfterSeconds };
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

  function successLog({
    requestId, identityContext, model, operation, endpoint, request,
    execution, usage, imageCount, charge, reservation, startedAt,
  }) {
    const requestedCompression = Number(request?.output_compression);
    const finalSize = charge.snapshot?.output_size
      || charge.snapshot?.input_size
      || request?.size
      || null;
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
      endpoint,
      operation,
      output_items: imageCount,
      final_size: finalSize,
      output_format: request?.output_format || request?.format || null,
      output_compression: Number.isFinite(requestedCompression) ? requestedCompression : null,
      image_metadata: {
        input_image_count: Number(request?.input_image_count || 0),
        has_mask: Boolean(request?.has_mask),
        billing_size: charge.snapshot?.size || null,
        size_source: charge.snapshot?.size_source || null,
      },
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

  function failureLog({
    requestId, identityContext, model, operation, endpoint, execution,
    usage, charge, reservation, reason, message, startedAt,
  }) {
    return {
      request_id: requestId,
      user_id: identityContext.userId,
      api_key_id: identityContext.apiKeyId,
      model_code: model,
      upstream_account_id: execution?.selection?.account?.id || null,
      status: 'failed',
      latency_ms: now() - startedAt,
      input_tokens: Number(usage?.inputTokens || 0),
      output_tokens: Number(usage?.outputTokens || 0),
      total_cost: Number(charge?.amount || 0),
      billing_mode: charge?.billingMode || (operation.startsWith('image_') ? 'image' : 'token'),
      error_type: reason,
      error_message: message,
      endpoint,
      operation,
      billing_snapshot: {
        operation,
        reservation: reservation?.snapshot || {},
        charge: charge?.snapshot || {},
      },
    };
  }

  function writeStreamError(res, protocol, operation, code, message) {
    if (res.writableEnded || res.destroyed) return;
    if (operation === 'responses') {
      res.write(`event: response.failed\ndata: ${JSON.stringify({
        type: 'response.failed',
        response: { status: 'failed', error: { type: 'upstream_error', code, message } },
      })}\n\n`);
    } else if (protocol === 'anthropic') {
      res.write(`event: error\ndata: ${JSON.stringify({
        type: 'error', error: { type: 'api_error', code, message },
      })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ error: { type: 'upstream_error', code, message } })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    res.end();
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
      const requiredCapability = prepared.capability || capability;
      if (typeof repository.supportsCapability === 'function') {
        let supported;
        try {
          supported = await repository.supportsCapability(identityContext, model, requiredCapability);
        } catch (error) {
          return next(error);
        }
        if (!supported) {
          return apiError(
            res,
            protocol,
            400,
            `${requiredCapability} is not supported for model ${model}`,
            'invalid_request_error',
            'capability_not_supported',
          );
        }
      }
      const requestId = requestIdFactory();
      let reservedAmount = 0;
      const startedAt = now();
      let lastLeaseRenewedAt = startedAt;
      let reservation;
      let activeSelection = null;
      let settlementRetry = null;
      const shouldStream = billingRequest.stream === true
        && ['chat_completions', 'responses', 'anthropic_messages'].includes(operation);
      const streamingMetrics = createResponseMetricsAccumulator(operation);
      const queueSettlementRetry = async retry => {
        const normalizedRetry = retry || {
          chargeAmount: 0,
          outcome: 'zero_released',
          log: pendingLog({
            requestId, identityContext, model, operation, reason: 'settlement_failed', startedAt,
          }),
        };
        await runtime.usageSettlement.markPending({
          userId: identityContext.userId,
          reservedAmount,
          requestId,
          log: {
            ...pendingLog({
              requestId, identityContext, model, operation, reason: 'settlement_failed', startedAt,
            }),
            billing_snapshot: {
              ...(normalizedRetry.log?.billing_snapshot || {}),
              reconciliation_reason: 'settlement_failed',
              settlement_retry: {
                charge_amount: Number(normalizedRetry.chargeAmount || 0),
                outcome: normalizedRetry.outcome,
                log: normalizedRetry.log || {},
                ...(normalizedRetry.pricingContext ? {
                  pricing_pending: true,
                  pricing_context: normalizedRetry.pricingContext,
                } : {}),
              },
            },
          },
        });
        reservedAmount = 0;
      };
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
          capability: requiredCapability,
          estimatedTokens: Number(reservation.estimatedTokens || 0),
        }, selection => {
          activeSelection = selection;
          if (prepared.execute) return prepared.execute(selection);
          const writeAndRenewStream = shouldStream ? async chunk => {
            if (typeof runtime.gatewayScheduler.renewLease === 'function') {
              const currentTime = now();
              if (currentTime - lastLeaseRenewedAt >= leaseRenewIntervalMs) {
                const renewal = await runtime.gatewayScheduler.renewLease(selection.lease);
                if (!renewal?.renewed) {
                  const error = new Error('Gateway concurrency lease was lost during upstream streaming');
                  error.code = 'lease_lost';
                  throw error;
                }
                lastLeaseRenewedAt = currentTime;
              }
            }
            await writeStreamingChunk(res, chunk);
          } : undefined;
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
            streamTimeouts,
            stream: shouldStream,
            onStreamStart: shouldStream ? snapshot => startStreamingResponse(res, snapshot) : undefined,
            onStreamChunk: writeAndRenewStream,
            onStreamEvent: shouldStream ? event => streamingMetrics.observe(event) : undefined,
            streamOperation: operation,
          });
        });

        const metrics = shouldStream
          ? streamingMetrics.result()
          : responseMetrics(execution.value, operation);
        const { payload, usage, imageCount } = metrics;
        const actualUsageKnown = operation.startsWith('image_')
          ? payload !== null
          : operation === 'anthropic_count_tokens'
            ? Number.isFinite(Number(payload?.input_tokens))
            : metrics.usageFound || imageCount > 0;
        if (!actualUsageKnown) {
          const charge = { amount: 0, billingMode: operation.startsWith('image_') ? 'image' : 'token', snapshot: {} };
          const log = failureLog({
            requestId, identityContext, model, operation, endpoint: upstreamPath,
            execution, usage, charge, reservation, reason: 'usage_missing',
            message: 'Upstream response completed without verifiable usage', startedAt,
          });
          settlementRetry = { chargeAmount: 0, log, outcome: 'zero_released' };
          await runtime.usageSettlement.settle({
            userId: identityContext.userId,
            reservedAmount,
            chargeAmount: 0,
            requestId,
            successLog: log,
            resultMetadata: { outcome: 'zero_released', usage_verified: false },
          });
          reservedAmount = 0;
          if (!res.headersSent) res.setHeader('x-settlement-status', 'zero_released');
          return finishSnapshotResponse(res, execution.value);
        }

        const quoteContext = {
          identity: identityContext, operation, model, request: billingRequest,
          usage, imageCount, selection: execution.selection, response: payload,
        };
        const persistedPricingContext = retryablePricingContext({
          identity: identityContext, operation, model, request: billingRequest,
          usage, imageCount, selection: execution.selection, response: payload,
        });
        const pricingPendingLog = successLog({
          requestId, identityContext, model, operation, endpoint: upstreamPath, request: billingRequest,
          execution, usage, imageCount,
          charge: { amount: 0, billingMode: operation.startsWith('image_') ? 'image' : 'token', snapshot: {} },
          reservation, startedAt,
        });
        settlementRetry = {
          chargeAmount: 0, log: pricingPendingLog, outcome: 'settled', pricingContext: persistedPricingContext,
        };
        const charge = await billingPolicy.quoteCharge(quoteContext);
        const log = successLog({
          requestId, identityContext, model, operation, endpoint: upstreamPath, request: billingRequest,
          execution, usage,
          imageCount, charge, reservation, startedAt,
        });
        settlementRetry = { chargeAmount: Number(charge.amount || 0), log, outcome: 'settled' };
        const settlement = await runtime.usageSettlement.settle({
          userId: identityContext.userId,
          reservedAmount,
          chargeAmount: Number(charge.amount || 0),
          requestId,
          successLog: log,
        });
        reservedAmount = 0;
        if (settlement?.pending && !res.headersSent) res.setHeader('x-settlement-status', 'pending');
        return finishSnapshotResponse(res, execution.value);
      } catch (error) {
        const upstreamHttpError = causeMatching(error, candidate => candidate instanceof UpstreamHttpError);
        if (reservedAmount > 0 && upstreamHttpError) {
          const charge = { amount: 0, billingMode: operation.startsWith('image_') ? 'image' : 'token', snapshot: {} };
          const log = failureLog({
            requestId, identityContext, model, operation, endpoint: upstreamPath,
            execution: activeSelection ? { selection: activeSelection } : null,
            usage: extractUsage({}), charge, reservation,
            reason: `upstream_http_${upstreamHttpError.status}`,
            message: `Upstream returned definitive HTTP ${upstreamHttpError.status}`,
            startedAt,
          });
          settlementRetry = { chargeAmount: 0, log, outcome: 'zero_released' };
          try {
            await runtime.usageSettlement.settle({
              userId: identityContext.userId,
              reservedAmount,
              chargeAmount: 0,
              requestId,
              successLog: log,
              resultMetadata: {
                outcome: 'zero_released',
                usage_verified: false,
                upstream_http_status: upstreamHttpError.status,
              },
            });
            reservedAmount = 0;
          } catch (settlementError) {
            try { await queueSettlementRetry(settlementRetry); }
            catch (_pendingError) { /* stale-reservation recovery remains available */ }
          }
          return writeSnapshot(res, upstreamHttpError.response);
        }
        const uncertain = causeMatching(error, candidate => candidate.executionUncertain === true);
        if (reservedAmount > 0 && uncertain) {
          const metrics = shouldStream
            ? streamingMetrics.result()
            : responseMetrics(uncertain.partialSnapshot || { body: Buffer.alloc(0) }, operation);
          const actualUsageKnown = metrics.usageFound || metrics.imageCount > 0;
        let charge = {
            amount: 0,
            billingMode: operation.startsWith('image_') ? 'image' : 'token',
          snapshot: {},
        };
          let persistedUncertainPricingContext = null;
          const outcome = actualUsageKnown ? 'partial_settled' : 'zero_released';
          const explicitFailureReasons = new Set([
            'first_byte_timeout', 'stream_idle_timeout', 'total_timeout', 'lease_lost',
            'stream_terminal_missing', 'upstream_stream_failed',
          ]);
          const failureReason = explicitFailureReasons.has(uncertain.code)
            ? uncertain.code
            : 'upstream_state_unknown';
          if (actualUsageKnown && activeSelection) {
            const quoteContext = {
              identity: identityContext, operation, model, request: billingRequest,
              usage: metrics.usage, imageCount: metrics.imageCount,
              selection: activeSelection, response: metrics.payload,
            };
            persistedUncertainPricingContext = retryablePricingContext({
              identity: identityContext, operation, model, request: billingRequest,
              usage: metrics.usage, imageCount: metrics.imageCount,
              selection: activeSelection, response: metrics.payload,
            });
            try {
              charge = await billingPolicy.quoteCharge(quoteContext);
            } catch (pricingError) {
              const retryLog = failureLog({
                requestId, identityContext, model, operation, endpoint: upstreamPath,
                execution: activeSelection ? { selection: activeSelection } : null,
                usage: metrics.usage, charge, reservation, reason: failureReason,
                message: `Usage was captured but pricing failed (${pricingError.code || 'pricing_error'})`, startedAt,
              });
              settlementRetry = {
                chargeAmount: 0, log: retryLog, outcome, pricingContext: persistedUncertainPricingContext,
              };
              try { await queueSettlementRetry(settlementRetry); }
              catch (_pendingError) { /* stale-reservation recovery remains available */ }
              if (res.headersSent) {
                writeStreamError(res, protocol, operation, failureReason, 'Upstream stream ended before completion');
                return res;
              }
              return next(pricingError);
            }
          }
          const log = failureLog({
            requestId, identityContext, model, operation, endpoint: upstreamPath,
            execution: activeSelection ? { selection: activeSelection } : null,
            usage: metrics.usage, charge, reservation, reason: failureReason,
            message: `Upstream stream ended abnormally (${uncertain.code || 'transport_error'})`, startedAt,
          });
          settlementRetry = {
            chargeAmount: Number(charge.amount || 0), log, outcome,
            ...(actualUsageKnown && Number(charge.amount || 0) === 0 ? {
              pricingContext: persistedUncertainPricingContext,
            } : {}),
          };
          try {
            await runtime.usageSettlement.settle({
              userId: identityContext.userId,
              reservedAmount,
              chargeAmount: settlementRetry.chargeAmount,
              requestId,
              successLog: log,
              resultMetadata: {
                outcome,
                usage_verified: actualUsageKnown,
                upstream_error_code: uncertain.code || 'upstream_transport_error',
              },
            });
            reservedAmount = 0;
          } catch (settlementError) {
            try {
              await queueSettlementRetry(settlementRetry);
            } catch (_pendingError) { /* reservation remains frozen for automatic retry */ }
            if (!res.headersSent) return next(settlementError);
          }
          if (res.headersSent) {
            writeStreamError(res, protocol, operation, failureReason, 'Upstream stream ended before completion');
            return res;
          }
          return apiError(
            res,
            protocol,
            502,
            'Upstream execution ended before completion',
            'upstream_error',
            failureReason,
          );
        }
        if (['redis_unavailable', 'no_account_available', 'account_capacity_exhausted'].includes(error.code)) {
          if (reservedAmount > 0) {
            await runtime.usageSettlement.release({
              userId: identityContext.userId,
              reservedAmount,
              requestId,
              remark: 'Gateway scheduling did not start an upstream request',
            });
            reservedAmount = 0;
          }
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
          if (error.code === 'account_capacity_exhausted') {
            const capacity = sanitizedCapacity(error);
            res.setHeader('Retry-After', String(capacity.retryAfterSeconds));
            return apiError(
              res,
              protocol,
              503,
              'No upstream account is currently available',
              'no_channel',
              error.code,
              { reasons: capacity.reasons },
            );
          }
          return apiError(res, protocol, 503, 'No upstream account is currently available', 'no_channel', error.code);
        }
        if (reservedAmount > 0) {
          try {
            await queueSettlementRetry(settlementRetry);
          } catch (_pendingError) { /* stale-reservation recovery remains available */ }
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
    {
      route: '/responses', operation: 'responses', capability: 'responses', protocol: 'openai_compatible', upstreamPath: 'responses',
      prepareRequest(req) {
        const usesImageTool = Array.isArray(req.body?.tools)
          && req.body.tools.some(tool => tool?.type === 'image_generation');
        return {
          model: req.body?.model,
          billingRequest: req.body,
          capability: usesImageTool ? 'image_transformations' : 'responses',
        };
      },
    },
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
