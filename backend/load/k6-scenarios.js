import http from 'k6/http';
import { check, sleep } from 'k6';

const defaultTarget = 'http://127.0.0.1:4010';
const target = String(__ENV.LOAD_TARGET || defaultTarget).replace(/\/+$/, '');
const allowExternal = String(__ENV.ALLOW_EXTERNAL_LOAD_TARGET || '').toLowerCase() === 'true';
const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(target);

if (!isLocalTarget && !allowExternal) {
  throw new Error('拒绝非 localhost 压测目标；仅在明确确认后设置 ALLOW_EXTERNAL_LOAD_TARGET=true');
}

export const options = {
  scenarios: {
    chat: { executor: 'constant-vus', exec: 'chat', vus: 5, duration: '15s' },
    capacity: { executor: 'constant-vus', exec: 'capacity', vus: 12, duration: '20s', startTime: '20s' },
    rateLimitFailover: { executor: 'constant-vus', exec: 'rateLimitFailover', vus: 4, duration: '15s', startTime: '45s' },
    upstreamFailureFailover: { executor: 'constant-vus', exec: 'upstreamFailureFailover', vus: 4, duration: '15s', startTime: '65s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000'],
  },
};

function params() {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...(__ENV.LOAD_API_KEY ? { Authorization: `Bearer ${__ENV.LOAD_API_KEY}` } : {}),
    },
  };
}

function post(loadScenario, expectedStatuses = [200]) {
  const response = http.post(`${target}/v1/chat/completions`, JSON.stringify({
    model: __ENV.LOAD_MODEL || 'load-chat',
    messages: [{ role: 'user', content: 'load test request' }],
    metadata: { load_scenario: loadScenario },
  }), params());
  check(response, { [`${loadScenario} accepted`]: item => expectedStatuses.includes(item.status) });
  sleep(0.1);
}

export function chat() { post('chat'); }
export function capacity() { post('capacity', [200, 429, 503]); }
export function rateLimitFailover() { post('rate_limit_failover'); }
export function upstreamFailureFailover() { post('upstream_failure_failover'); }
