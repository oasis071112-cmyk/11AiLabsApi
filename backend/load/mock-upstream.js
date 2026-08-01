const http = require('node:http');

function readJson(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1_000_000) return reject(Object.assign(new Error('request too large'), { status: 413 }));
      body += chunk;
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (_error) { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
}

function mockResponse(body) {
  return {
    id: `chatcmpl-load-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'load-chat',
    choices: [{ index: 0, message: { role: 'assistant', content: 'mock load response' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  };
}

function isChatPath(pathname) {
  return pathname === '/v1/chat/completions' || pathname.endsWith('/v1/chat/completions');
}

function isModelsPath(pathname) {
  return pathname === '/v1/models' || pathname.endsWith('/v1/models');
}

function isPrimaryPath(pathname) {
  return pathname.startsWith('/primary/');
}

function createMockUpstreamServer({ host = '127.0.0.1', port = 4010, logger = console } = {}) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || host}`);
    if (request.method === 'GET' && isModelsPath(url.pathname)) {
      return sendJson(response, 200, {
        object: 'list',
        data: [{ id: 'load-chat', object: 'model', owned_by: 'mock-upstream' }],
      });
    }
    if (request.method !== 'POST' || !isChatPath(url.pathname)) {
      return sendJson(response, 404, { error: { message: 'mock endpoint not found', type: 'not_found' } });
    }
    let body;
    try { body = await readJson(request); }
    catch (error) { return sendJson(response, error.status || 400, { error: { message: error.message, type: 'invalid_request_error' } }); }

    const scenario = String(body?.metadata?.load_scenario || 'chat');
    const primary = isPrimaryPath(url.pathname);
    if (scenario === 'rate_limit_failover' && primary) {
      return sendJson(response, 429, { error: { message: 'mock primary rate limit', type: 'rate_limit_error' } }, { 'retry-after': '1' });
    }
    if (scenario === 'upstream_failure_failover' && primary) {
      return sendJson(response, 503, { error: { message: 'mock primary unavailable', type: 'server_error' } });
    }
    const delay = scenario === 'capacity' ? 250 : 0;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    return sendJson(response, 200, mockResponse(body));
  });

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
      });
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      logger.info?.(`mock upstream listening at http://${host}:${actualPort}`);
      return { host, port: actualPort };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (require.main === module) {
  createMockUpstreamServer().listen().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createMockUpstreamServer };
