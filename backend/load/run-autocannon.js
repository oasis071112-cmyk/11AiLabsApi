const { resolveLoadConfig } = require('./safety');
const { availableScenarioNames, createAutocannonScenario } = require('./autocannon-scenarios');

function loadAutocannon() {
  try {
    return require('autocannon');
  } catch (_error) {
    throw new Error('未安装 autocannon；请使用全局安装或临时 npx 包后重试，且不要把它写入生产依赖');
  }
}

function main(environment = process.env) {
  const config = resolveLoadConfig(environment);
  const scenarioName = String(environment.LOAD_SCENARIO || 'chat');
  const options = createAutocannonScenario(scenarioName, config, environment);
  const autocannon = loadAutocannon();
  console.log(`autocannon scenario=${scenarioName} target=${config.target} local=${config.isLocalTarget}`);
  const instance = autocannon(options, (error, result) => {
    if (error) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ scenario: scenarioName, requests: result.requests, latency: result.latency, errors: result.errors }));
  });
  autocannon.track(instance, { renderProgressBar: true, renderResultsTable: true });
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`${error.message}\n可选场景：${availableScenarioNames().join(', ')}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
