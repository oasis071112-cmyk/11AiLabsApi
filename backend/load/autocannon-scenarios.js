const { requestHeaders } = require('./safety');

const SCENARIOS = Object.freeze({
  chat: { connections: 10, duration: 15, loadScenario: 'chat' },
  capacity: { connections: 16, duration: 20, loadScenario: 'capacity' },
  rate_limit_failover: { connections: 6, duration: 15, loadScenario: 'rate_limit_failover' },
  upstream_failure_failover: { connections: 6, duration: 15, loadScenario: 'upstream_failure_failover' },
});

function boundedPositive(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function availableScenarioNames() {
  return Object.keys(SCENARIOS);
}

function createAutocannonScenario(name, config, environment = process.env) {
  const definition = SCENARIOS[name];
  if (!definition) throw new Error(`未知 LOAD_SCENARIO=${name}；可选 ${availableScenarioNames().join(', ')}`);
  return {
    url: `${config.target}/v1/chat/completions`,
    method: 'POST',
    connections: boundedPositive(environment.LOAD_CONNECTIONS, definition.connections),
    duration: boundedPositive(environment.LOAD_DURATION_SECONDS, definition.duration),
    headers: requestHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: 'load test request' }],
      metadata: { load_scenario: definition.loadScenario },
    }),
  };
}

module.exports = { SCENARIOS, availableScenarioNames, createAutocannonScenario };
