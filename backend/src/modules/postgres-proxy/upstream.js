const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'x-request-id',
  'request-id',
  'openai-processing-ms',
  'anthropic-ratelimit-requests-limit',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-limit',
  'anthropic-ratelimit-tokens-remaining',
  'anthropic-ratelimit-tokens-reset',
  'retry-after',
]);

class UpstreamHttpError extends Error {
  constructor(response) {
    super(`Upstream returned HTTP ${response.status}`);
    this.name = 'UpstreamHttpError';
    this.status = response.status;
    this.code = response.status === 429 ? 'rate_limit_exceeded' : `upstream_http_${response.status}`;
    this.retryAfterMs = retryAfterMilliseconds(response.headers?.['retry-after']);
    this.response = response;
    this.executionUncertain = false;
  }
}

class UpstreamTransportError extends Error {
  constructor(cause, { retryable = false, responseStarted = false } = {}) {
    super('Upstream execution state is uncertain', { cause });
    this.name = 'UpstreamTransportError';
    this.code = cause?.code || cause?.name || 'upstream_transport_error';
    this.retryable = retryable;
    this.responseStarted = responseStarted;
    this.executionUncertain = true;
  }
}

function retryAfterMilliseconds(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function upstreamUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function authorizationHeaders(selection, secretBox, requestHeaders = {}) {
  const account = selection.account;
  const apiKey = secretBox.open(account.credentialEnvelope, {
    aad: `upstream_accounts:${account.accountKey}`,
  });
  if (account.protocol === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': String(requestHeaders['anthropic-version'] || '2023-06-01'),
      ...(requestHeaders['anthropic-beta'] ? { 'anthropic-beta': String(requestHeaders['anthropic-beta']) } : {}),
    };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function safeResponseHeaders(response) {
  const headers = {};
  response.headers.forEach((value, name) => {
    if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  });
  return headers;
}

async function snapshotResponse(response) {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = safeResponseHeaders(response);
  return { status: response.status, headers, body };
}

async function snapshotStreamingResponse(response, { onStart, onChunk, abort } = {}) {
  const headers = safeResponseHeaders(response);
  if (response.status >= 400) {
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers, body };
  }
  let responseStarted = false;
  let reader;
  const chunks = [];
  try {
    responseStarted = true;
    await onStart?.({ status: response.status, headers });
    if (response.body?.getReader) {
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        await onChunk?.(chunk);
      }
    } else {
      const chunk = Buffer.from(await response.arrayBuffer());
      chunks.push(chunk);
      await onChunk?.(chunk);
    }
  } catch (error) {
    try { await reader?.cancel(error); } catch (_cancelError) { /* best-effort body cleanup */ }
    abort?.(error);
    throw new UpstreamTransportError(error, { retryable: !responseStarted, responseStarted });
  } finally {
    try { reader?.releaseLock(); } catch (_releaseError) { /* already released/cancelled */ }
  }
  return { status: response.status, headers, body: Buffer.concat(chunks), streamed: true };
}

async function executeJsonUpstream({
  fetchImpl,
  selection,
  secretBox,
  path,
  body,
  requestHeaders,
  timeoutMs,
  stream = false,
  onStreamStart,
  onStreamChunk,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(upstreamUrl(selection.account.baseUrl, path), {
      method: 'POST',
      headers: {
        ...authorizationHeaders(selection, secretBox, requestHeaders),
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify({
        ...body,
        model: selection.upstreamModel,
        ...(Array.isArray(body.tools) ? {
          tools: body.tools.map(tool => tool?.type === 'image_generation'
            ? { ...tool, model: selection.upstreamModel }
            : tool),
        } : {}),
      }),
      signal: controller.signal,
    });
    const snapshot = stream
      ? await snapshotStreamingResponse(response, {
        onStart: onStreamStart,
        onChunk: onStreamChunk,
        abort: reason => { if (!controller.signal.aborted) controller.abort(reason); },
      })
      : await snapshotResponse(response);
    if (response.status >= 400) throw new UpstreamHttpError(snapshot);
    return snapshot;
  } catch (error) {
    if (error instanceof UpstreamHttpError || error instanceof UpstreamTransportError) throw error;
    throw new UpstreamTransportError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function appendMultipartValue(form, key, value) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) appendMultipartValue(form, key, item);
    return;
  }
  form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

function multipartBody({ body, files, upstreamModel }) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...body, model: upstreamModel })) {
    appendMultipartValue(form, key, value);
  }
  for (const file of files.images || []) {
    form.append(
      'image',
      new Blob([Buffer.from(file.buffer)], { type: file.mimetype }),
      file.originalname || 'image.png',
    );
  }
  if (files.mask) {
    form.append(
      'mask',
      new Blob([Buffer.from(files.mask.buffer)], { type: files.mask.mimetype }),
      files.mask.originalname || 'mask.png',
    );
  }
  return form;
}

async function executeMultipartUpstream({
  fetchImpl,
  selection,
  secretBox,
  path,
  body,
  files,
  requestHeaders,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(upstreamUrl(selection.account.baseUrl, path), {
      method: 'POST',
      headers: {
        ...authorizationHeaders(selection, secretBox, requestHeaders),
        Accept: 'application/json',
      },
      body: multipartBody({ body, files, upstreamModel: selection.upstreamModel }),
      signal: controller.signal,
    });
    const snapshot = await snapshotResponse(response);
    if (response.status >= 400) throw new UpstreamHttpError(snapshot);
    return snapshot;
  } catch (error) {
    if (error instanceof UpstreamHttpError || error instanceof UpstreamTransportError) throw error;
    throw new UpstreamTransportError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function jsonFromSnapshot(snapshot) {
  try {
    return JSON.parse(snapshot.body.toString('utf8'));
  } catch (_error) {
    return null;
  }
}

function jsonEventsFromSnapshot(snapshot) {
  const events = [];
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n').trim();
    dataLines = [];
    if (!data || data === '[DONE]') return;
    try { events.push(JSON.parse(data)); }
    catch (_error) { /* ignore non-JSON provider heartbeats */ }
  };
  for (const line of snapshot.body.toString('utf8').split(/\r?\n/)) {
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  flush();
  return events;
}

function writeSnapshot(res, snapshot) {
  for (const [name, value] of Object.entries(snapshot.headers || {})) res.setHeader(name, value);
  return res.status(snapshot.status).send(snapshot.body);
}

module.exports = {
  UpstreamHttpError,
  UpstreamTransportError,
  executeJsonUpstream,
  executeMultipartUpstream,
  jsonEventsFromSnapshot,
  jsonFromSnapshot,
  upstreamUrl,
  writeSnapshot,
};
