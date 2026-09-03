const { StringDecoder } = require('node:string_decoder');

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
  constructor(cause, { retryable = false, responseStarted = false, partialSnapshot = null } = {}) {
    super('Upstream execution state is uncertain', { cause });
    this.name = 'UpstreamTransportError';
    this.code = cause?.code || cause?.name || 'upstream_transport_error';
    this.retryable = retryable;
    this.responseStarted = responseStarted;
    this.partialSnapshot = partialSnapshot;
    this.executionUncertain = true;
  }
}

function timeoutError(code, message) {
  const error = new Error(message);
  error.name = 'UpstreamTimeoutError';
  error.code = code;
  return error;
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
  const actorAuthorization = String(requestHeaders['x-openai-actor-authorization'] || '').trim();
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(actorAuthorization === 'local-image-extension'
      ? { 'x-openai-actor-authorization': 'local-image-extension' }
      : {}),
  };
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

async function abortableRead(reader, signal) {
  return abortablePromise(reader.read(), signal);
}

async function abortablePromise(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason || timeoutError('upstream_aborted', 'Upstream request aborted');
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason || timeoutError('upstream_aborted', 'Upstream request aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function createSseJsonParser() {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let dataLines = [];
  const events = [];
  const eventTypes = new Set();
  let sawDone = false;
  let sawError = false;
  const flushEvent = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n').trim();
    dataLines = [];
    if (!data) return;
    if (data === '[DONE]') {
      sawDone = true;
      return;
    }
    try {
      const event = JSON.parse(data);
      events.push(event);
      if (event?.type) eventTypes.add(event.type);
      if (event?.error || event?.type === 'error' || event?.type === 'response.failed') sawError = true;
    }
    catch (_error) { /* incomplete/non-JSON provider heartbeats are not verifiable usage */ }
  };
  const consumeLines = (end = false) => {
    while (true) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (line === '') flushEvent();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (end && pending) {
      const line = pending.replace(/\r$/, '');
      pending = '';
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (end) flushEvent();
    return events.splice(0);
  };
  return {
    push(chunk) {
      pending += decoder.write(chunk);
      return consumeLines(false);
    },
    end() {
      pending += decoder.end();
      return consumeLines(true);
    },
    state() {
      return { done: sawDone, failed: sawError, eventTypes: [...eventTypes] };
    },
  };
}

async function snapshotStreamingResponse(response, {
  onStart, onChunk, onEvent, onActivity, abort, signal,
} = {}) {
  const headers = safeResponseHeaders(response);
  if (response.status >= 400) {
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers, body };
  }
  let responseStarted = false;
  let reader;
  const chunks = [];
  let capturedBytes = 0;
  const captureLimitBytes = 1024 * 1024;
  const capture = chunk => {
    if (capturedBytes >= captureLimitBytes) return;
    const captured = chunk.subarray(0, captureLimitBytes - capturedBytes);
    chunks.push(captured);
    capturedBytes += captured.length;
  };
  const eventParser = createSseJsonParser();
  const observeEvents = async events => {
    if (!onEvent) return;
    for (const event of events) {
      await abortablePromise(Promise.resolve().then(() => onEvent(event)), signal);
    }
  };
  try {
    responseStarted = true;
    await onStart?.({ status: response.status, headers });
    if (response.body?.getReader) {
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await abortableRead(reader, signal);
        if (done) break;
        const chunk = Buffer.from(value);
        if (chunk.length === 0) continue;
        capture(chunk);
        onActivity?.(chunk);
        await observeEvents(eventParser.push(chunk));
        if (onChunk) await abortablePromise(Promise.resolve().then(() => onChunk(chunk)), signal);
      }
      await observeEvents(eventParser.end());
    } else {
      const chunk = Buffer.from(await response.arrayBuffer());
      capture(chunk);
      if (chunk.length > 0) onActivity?.(chunk);
      await observeEvents(eventParser.push(chunk));
      await observeEvents(eventParser.end());
      if (onChunk) await abortablePromise(Promise.resolve().then(() => onChunk(chunk)), signal);
    }
  } catch (error) {
    try { await reader?.cancel(error); } catch (_cancelError) { /* best-effort body cleanup */ }
    abort?.(error);
    throw new UpstreamTransportError(error, {
      retryable: !responseStarted,
      responseStarted,
      partialSnapshot: {
        status: response.status,
        headers,
        body: Buffer.concat(chunks),
        streamed: true,
        streamState: eventParser.state(),
      },
    });
  } finally {
    try { reader?.releaseLock(); } catch (_releaseError) { /* already released/cancelled */ }
  }
  return {
    status: response.status,
    headers,
    body: Buffer.concat(chunks),
    streamed: true,
    streamState: eventParser.state(),
  };
}

async function executeJsonUpstream({
  fetchImpl,
  selection,
  secretBox,
  path,
  body,
  requestHeaders,
  timeoutMs,
  streamTimeouts,
  stream = false,
  onStreamStart,
  onStreamChunk,
  onStreamEvent,
  streamOperation,
}) {
  const controller = new AbortController();
  const timers = new Set();
  let firstByteTimer = null;
  let idleTimer = null;
  const scheduleAbort = (delayMs, code, message) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!controller.signal.aborted) controller.abort(timeoutError(code, message));
    }, delayMs);
    timers.add(timer);
    return timer;
  };
  const clearScheduled = timer => {
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(timer);
  };
  const configuredFirstByte = Number(streamTimeouts?.firstByteTimeoutMs ?? timeoutMs);
  const configuredIdle = Number(streamTimeouts?.idleTimeoutMs ?? timeoutMs);
  const configuredTotal = Number(streamTimeouts?.totalTimeoutMs ?? timeoutMs);
  if (stream) {
    firstByteTimer = scheduleAbort(configuredFirstByte, 'first_byte_timeout', 'Upstream first byte timed out');
    scheduleAbort(configuredTotal, 'total_timeout', 'Upstream total streaming duration exceeded');
  } else {
    scheduleAbort(timeoutMs, 'upstream_timeout', 'Upstream request timed out');
  }
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
        onEvent: onStreamEvent,
        signal: controller.signal,
        onActivity: () => {
          clearScheduled(firstByteTimer);
          firstByteTimer = null;
          clearScheduled(idleTimer);
          idleTimer = scheduleAbort(configuredIdle, 'stream_idle_timeout', 'Upstream stream became idle');
        },
        abort: reason => { if (!controller.signal.aborted) controller.abort(reason); },
      })
      : await snapshotResponse(response);
    if (response.status >= 400) throw new UpstreamHttpError(snapshot);
    if (stream && streamOperation) {
      const terminal = streamTerminalState(snapshot, streamOperation);
      if (terminal.failed || !terminal.completed) {
        const cause = new Error(terminal.failed
          ? 'Upstream stream reported a terminal failure'
          : 'Upstream stream ended without a terminal event');
        cause.code = terminal.failed ? 'upstream_stream_failed' : 'stream_terminal_missing';
        throw new UpstreamTransportError(cause, {
          responseStarted: true,
          partialSnapshot: snapshot,
        });
      }
    }
    return snapshot;
  } catch (error) {
    if (error instanceof UpstreamHttpError || error instanceof UpstreamTransportError) throw error;
    throw new UpstreamTransportError(error);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
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

function streamTerminalState(snapshot, operation) {
  const body = snapshot?.body?.toString('utf8') || '';
  const events = jsonEventsFromSnapshot(snapshot || { body: Buffer.alloc(0) });
  const streamedTypes = new Set(snapshot?.streamState?.eventTypes || []);
  for (const event of events) if (event?.type) streamedTypes.add(event.type);
  if (operation === 'chat_completions') {
    return {
      completed: snapshot?.streamState?.done === true || /^data:\s*\[DONE\]\s*$/m.test(body),
      failed: snapshot?.streamState?.failed === true || events.some(event => Boolean(event?.error)),
    };
  }
  if (operation === 'responses') {
    return {
      completed: streamedTypes.has('response.completed'),
      failed: streamedTypes.has('response.failed') || streamedTypes.has('error'),
    };
  }
  if (operation === 'anthropic_messages') {
    return {
      completed: streamedTypes.has('message_stop'),
      failed: streamedTypes.has('error'),
    };
  }
  return { completed: true, failed: false };
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
  createSseJsonParser,
  jsonEventsFromSnapshot,
  jsonFromSnapshot,
  streamTerminalState,
  upstreamUrl,
  writeSnapshot,
};
