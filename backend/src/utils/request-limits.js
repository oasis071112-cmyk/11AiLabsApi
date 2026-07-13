const PROVIDER_OUTPUT_LIMITS = {
  // DeepSeek 的上游明确拒绝大于此值的 max_tokens；低价模型不能只按余额反推输出上限。
  deepseek: 393216,
};

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function resolveChatOutputLimit({ model, requestBody, estimatedInputTokens, maxAffordableOutput }) {
  const provider = String(model?.official_provider || '').toLowerCase();
  const modelCode = String(model?.official_model_id || model?.model_code || '').toLowerCase();
  const modernOpenAiModel = provider === 'openai' && /^(gpt-5|o[1-9])/.test(modelCode);
  const limitField = Object.prototype.hasOwnProperty.call(requestBody, 'max_completion_tokens')
    ? 'max_completion_tokens'
    : (Object.prototype.hasOwnProperty.call(requestBody, 'max_tokens') ? 'max_tokens' : (modernOpenAiModel ? 'max_completion_tokens' : 'max_tokens'));

  const requested = positiveInteger(requestBody[limitField]);
  const affordable = positiveInteger(maxAffordableOutput);
  const contextLength = positiveInteger(model?.context_length);
  const remainingContext = contextLength ? Math.max(1, contextLength - Math.max(0, Number(estimatedInputTokens) || 0)) : null;
  const providerLimit = PROVIDER_OUTPUT_LIMITS[provider] || null;
  const allowed = [affordable, remainingContext, providerLimit].filter(Boolean);
  const maxAllowed = Math.min(...allowed);

  return {
    limitField,
    maxTokens: requested ? Math.min(requested, maxAllowed) : maxAllowed,
  };
}

module.exports = { resolveChatOutputLimit };
