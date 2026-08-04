const {
  calculateImagePricing,
  calculatePricing,
  resolveImageUnitPrice,
} = require('../../utils/pricing-engine');
const {
  generatedImageOutputSizes,
  resolveImageBillingSize,
} = require('../../utils/image-billing');
const { withProviderCachePricing } = require('../../utils/billing-policy');

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); }
  catch (_error) { return {}; }
}

function numeric(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function price(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class PostgresProxyRepository {
  constructor(pool) {
    if (!pool?.query) throw new Error('PostgresProxyRepository pool is required');
    this.pool = pool;
  }

  async listModels(identity = {}) {
    const allowedModels = Array.isArray(identity.allowedModels)
      ? identity.allowedModels.map(String)
      : [];
    if (allowedModels.length === 0) return [];
    const { rows } = await this.pool.query(`
      WITH RECURSIVE eligible_groups AS (
        SELECT id,fallback_group_id FROM routing_groups
        WHERE status='active' AND ($2::bigint IS NULL OR id=$2)
        UNION
        SELECT fallback.id,fallback.fallback_group_id FROM routing_groups fallback
        JOIN eligible_groups current ON fallback.id=current.fallback_group_id
        WHERE fallback.status='active'
      )
      SELECT m.model_code,m.provider,m.created_at,
        m.capabilities || jsonb_build_object(
          'image_input',COALESCE(available.image_input,FALSE),
          'chat_completions',COALESCE(available.chat_completions,FALSE),
          'embeddings',COALESCE(available.embeddings,FALSE),
          'responses',COALESCE(available.responses,FALSE),
          'image_generations',COALESCE(available.image_generations,FALSE),
          'image_edits',COALESCE(available.image_edits,FALSE),
          'image_variations',COALESCE(available.image_variations,FALSE),
          'image_transformations',COALESCE(available.image_transformations,FALSE),
          'anthropic_messages',COALESCE(available.anthropic_messages,FALSE),
          'anthropic_count_tokens',COALESCE(available.anthropic_count_tokens,FALSE)
        ) AS effective_capabilities
      FROM models m
      LEFT JOIN LATERAL (
        SELECT
          BOOL_OR(am.supports_image_input) AS image_input,
          BOOL_OR(ua.capabilities ? 'chat_completions') AS chat_completions,
          BOOL_OR(ua.capabilities ? 'embeddings') AS embeddings,
          BOOL_OR(ua.capabilities ? 'responses') AS responses,
          BOOL_OR(ua.capabilities ? 'image_generations') AS image_generations,
          BOOL_OR(ua.capabilities ? 'image_edits' AND am.supports_image_input) AS image_edits,
          BOOL_OR(ua.capabilities ? 'image_variations' AND am.supports_image_input) AS image_variations,
          BOOL_OR(ua.capabilities ? 'image_transformations' AND am.supports_image_input) AS image_transformations,
          BOOL_OR(ua.capabilities ? 'anthropic_messages') AS anthropic_messages,
          BOOL_OR(ua.capabilities ? 'anthropic_count_tokens') AS anthropic_count_tokens
        FROM account_models am
        JOIN upstream_accounts ua ON ua.id=am.account_id AND ua.status='active'
        JOIN routing_group_accounts rga ON rga.account_id=ua.id AND rga.status='active'
        JOIN eligible_groups eligible ON eligible.id=rga.routing_group_id
        WHERE am.model_code=m.model_code AND am.status='active'
      ) available ON TRUE
      WHERE m.status='active' AND m.model_code=ANY($1::text[])
      ORDER BY m.sort_order ASC,m.model_code ASC
    `, [allowedModels, identity.routingGroupId ?? null]);
    return rows.map(row => ({
      id: row.model_code,
      object: 'model',
      created: Math.floor(new Date(row.created_at || 0).getTime() / 1_000),
      owned_by: row.provider || 'ionailabs',
      capabilities: jsonObject(row.effective_capabilities),
    }));
  }

  async supportsCapability(identity = {}, model, capability) {
    const { rows } = await this.pool.query(`
      WITH RECURSIVE eligible_groups AS (
        SELECT id,fallback_group_id FROM routing_groups
        WHERE status='active' AND ($2::bigint IS NULL OR id=$2)
        UNION
        SELECT fallback.id,fallback.fallback_group_id FROM routing_groups fallback
        JOIN eligible_groups current ON fallback.id=current.fallback_group_id
        WHERE fallback.status='active'
      )
      SELECT EXISTS (
        SELECT 1 FROM account_models am
        JOIN models m ON m.model_code=am.model_code AND m.status='active'
        JOIN upstream_accounts ua ON ua.id=am.account_id AND ua.status='active'
        JOIN routing_group_accounts rga ON rga.account_id=ua.id AND rga.status='active'
        JOIN eligible_groups eligible ON eligible.id=rga.routing_group_id
        WHERE am.model_code=$1 AND am.status='active'
          AND ua.capabilities ? $3
          AND ($3 NOT IN ('image_edits','image_variations','image_transformations') OR am.supports_image_input)
      ) AS supported
    `, [model, identity.routingGroupId ?? null, capability]);
    return rows[0]?.supported === true || rows[0]?.supported === 't';
  }
}

class PostgresProxyBillingPolicy {
  constructor(pool, { defaultOutputTokens = 4_096, minimumReservation = 0.000001 } = {}) {
    if (!pool?.query) throw new Error('PostgresProxyBillingPolicy pool is required');
    this.pool = pool;
    this.defaultOutputTokens = defaultOutputTokens;
    this.minimumReservation = minimumReservation;
  }

  async loadPolicy(model, routingGroupId, userId = null) {
    const { rows } = await this.pool.query(`
      WITH RECURSIVE eligible_groups AS (
        SELECT id,fallback_group_id FROM routing_groups WHERE id=$2 AND status='active'
        UNION
        SELECT fallback.id,fallback.fallback_group_id
        FROM routing_groups fallback JOIN eligible_groups current ON fallback.id=current.fallback_group_id
        WHERE fallback.status='active'
      )
      SELECT m.model_code,m.model_type,m.context_length,m.metadata,m.official_provider,
        m.official_currency,m.official_input_price,m.official_output_price,
        m.official_cached_input_price,m.official_unit_tokens,
        COALESCE(rgm.billing_multiplier_input,rgm.billing_multiplier,rg.billing_multiplier_input) AS input_multiplier,
        COALESCE(rgm.billing_multiplier_output,rgm.billing_multiplier,rg.billing_multiplier_output) AS output_multiplier,
        COALESCE(rgm.billing_multiplier_image,rgm.billing_multiplier,rg.billing_multiplier_image) AS image_multiplier,
        platform_pricing.billing_mode AS platform_billing_mode,platform_pricing.rule AS platform_rule,
        user_pricing.billing_mode AS user_billing_mode,user_pricing.rule AS user_rule,
        candidates.configurations AS candidate_configurations,
        (SELECT config_value FROM system_config WHERE config_key='usd_cny_exchange_rate') AS usd_cny_rate
      FROM models m
      LEFT JOIN routing_groups rg ON rg.id=$2 AND rg.status='active'
      LEFT JOIN routing_group_models rgm ON rgm.routing_group_id=rg.id
        AND rgm.model_code=m.model_code AND rgm.status='active'
      LEFT JOIN LATERAL (
        SELECT billing_mode,rule FROM pricing_rules
        WHERE status='active' AND (model_code=m.model_code OR model_code IS NULL)
          AND COALESCE(rule->>'scope_type','platform')='platform'
          AND CASE WHEN NULLIF(rule->>'start_time','') IS NULL THEN TRUE
            WHEN pg_input_is_valid(rule->>'start_time','timestamp with time zone')
              THEN (rule->>'start_time')::timestamptz<=CURRENT_TIMESTAMP ELSE FALSE END
          AND CASE WHEN NULLIF(rule->>'end_time','') IS NULL THEN TRUE
            WHEN pg_input_is_valid(rule->>'end_time','timestamp with time zone')
              THEN (rule->>'end_time')::timestamptz>=CURRENT_TIMESTAMP ELSE FALSE END
        ORDER BY (model_code=m.model_code) DESC,COALESCE((rule->>'priority')::integer,0) DESC,updated_at DESC LIMIT 1
      ) platform_pricing ON TRUE
      LEFT JOIN LATERAL (
        SELECT billing_mode,rule FROM pricing_rules
        WHERE status='active' AND $3::bigint IS NOT NULL
          AND (model_code=m.model_code OR model_code IS NULL)
          AND COALESCE(rule->>'scope_type','platform')='user'
          AND CASE WHEN COALESCE(rule->>'scope_id','') ~ '^[0-9]+$'
            THEN (rule->>'scope_id')::bigint=$3::bigint ELSE FALSE END
          AND CASE WHEN NULLIF(rule->>'start_time','') IS NULL THEN TRUE
            WHEN pg_input_is_valid(rule->>'start_time','timestamp with time zone')
              THEN (rule->>'start_time')::timestamptz<=CURRENT_TIMESTAMP ELSE FALSE END
          AND CASE WHEN NULLIF(rule->>'end_time','') IS NULL THEN TRUE
            WHEN pg_input_is_valid(rule->>'end_time','timestamp with time zone')
              THEN (rule->>'end_time')::timestamptz>=CURRENT_TIMESTAMP ELSE FALSE END
        ORDER BY (model_code=m.model_code) DESC,COALESCE((rule->>'priority')::integer,0) DESC,updated_at DESC LIMIT 1
      ) user_pricing ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(am.configuration),'[]'::jsonb) AS configurations
        FROM account_models am
        JOIN upstream_accounts ua ON ua.id=am.account_id AND ua.status='active'
        JOIN routing_group_accounts rga ON rga.account_id=ua.id AND rga.status='active'
        JOIN eligible_groups eligible ON eligible.id=rga.routing_group_id
        WHERE am.model_code=m.model_code AND am.status='active'
      ) candidates ON TRUE
      WHERE m.model_code=$1 AND m.status='active'
    `, [model, routingGroupId ?? null, userId ?? null]);
    if (!rows[0]) {
      const error = new Error(`Model ${model} is not available for billing`);
      error.code = 'model_not_found';
      error.status = 404;
      throw error;
    }
    const row = rows[0];
    const metadata = jsonObject(row.metadata);
    const legacyRule = jsonObject(row.rule);
    const platformRule = Object.keys(jsonObject(row.platform_rule)).length
      ? jsonObject(row.platform_rule)
      : legacyRule;
    const userRule = jsonObject(row.user_rule);
    const rule = { ...platformRule, ...userRule };
    const inputPrice = price(row.official_input_price, metadata.official_input_price, rule.input_price);
    const outputPrice = price(row.official_output_price, metadata.official_output_price, rule.output_price);
    return {
      model,
      officialProvider: row.official_provider || metadata.official_provider || '',
      modelType: row.model_type || metadata.model_type || 'llm',
      contextLength: positive(row.context_length, positive(metadata.context_length, 0)),
      billingMode: row.user_billing_mode || row.platform_billing_mode || row.billing_mode || rule.billing_mode || 'token',
      currency: row.official_currency || metadata.official_currency || rule.official_currency || 'USD',
      unitTokens: positive(row.official_unit_tokens, positive(metadata.official_unit_tokens, 1_000_000)),
      usdCnyRate: positive(row.usd_cny_rate, 7),
      prices: {
        input: inputPrice,
        output: outputPrice,
        cachedInput: price(
          row.official_cached_input_price,
          metadata.official_cached_input_price,
          rule.cached_input_price,
        ),
        cacheCreation: price(metadata.official_cache_creation_price, rule.official_cache_creation_price),
        cacheCreation5m: price(metadata.official_cache_creation_5m_price, rule.official_cache_creation_5m_price),
        cacheCreation1h: price(metadata.official_cache_creation_1h_price, rule.official_cache_creation_1h_price),
      },
      imagePrices: metadata.official_image_prices || rule.official_image_prices || rule.image_prices || {},
      perRequestPrice: price(rule.per_request_price),
      candidateConfigurations: Array.isArray(row.candidate_configurations) ? row.candidate_configurations : [],
      multipliers: {
        input: positive(userRule.billing_multiplier_input,
          positive(row.input_multiplier, positive(platformRule.billing_multiplier_input, 1))),
        output: positive(userRule.billing_multiplier_output,
          positive(row.output_multiplier, positive(platformRule.billing_multiplier_output, 1))),
        image: positive(userRule.billing_multiplier_image,
          positive(row.image_multiplier, positive(platformRule.billing_multiplier_image, 1))),
      },
    };
  }

  mappedConfiguration(context) {
    const mappings = context.selection?.account?.modelMappings || [];
    return jsonObject(mappings.find(mapping => mapping.model === context.model)?.configuration);
  }

  isImage(context) {
    if (String(context.operation).startsWith('image_')) return true;
    return context.operation === 'responses'
      && Array.isArray(context.request?.tools)
      && context.request.tools.some(tool => tool?.type === 'image_generation');
  }

  imageQuote(policy, context, imageCount) {
    const mapped = this.mappedConfiguration(context);
    const sizeResolution = resolveImageBillingSize({
      inputSize: context.request?.size,
      outputSizes: generatedImageOutputSizes(context.response || {}),
    });
    const size = sizeResolution.billingSize;
    const requestedCount = Math.max(0, Math.floor(Number(imageCount || 0)));
    const actualBreakdown = sizeResolution.source === 'output' && sizeResolution.breakdown
      ? sizeResolution.breakdown
      : null;
    const tierCounts = {};
    let remaining = requestedCount;
    for (const tier of ['1K', '2K', '4K']) {
      const count = Math.min(remaining, Math.max(0, Math.floor(Number(actualBreakdown?.[tier] || 0))));
      if (count > 0) tierCounts[tier] = count;
      remaining -= count;
    }
    if (remaining > 0) tierCounts[size] = (tierCounts[size] || 0) + remaining;

    let amount = 0;
    const tierCharges = {};
    for (const [tier, count] of Object.entries(tierCounts)) {
      const channelPrice = price(
        mapped[`image_price_${tier.toLowerCase()}`],
        mapped[`image_price_${tier.replace('K', 'k')}`],
      );
      let unitPrice = channelPrice > 0
        ? channelPrice
        : resolveImageUnitPrice({ serializedPrices: policy.imagePrices, sizeTier: tier });
      if (!(unitPrice > 0)) unitPrice = resolveImageUnitPrice({ serializedPrices: {}, sizeTier: tier });
      const currency = channelPrice > 0 ? 'USD' : policy.currency;
      const result = calculateImagePricing({
        imageCount: count,
        unitPrice,
        currency,
        multiplier: policy.multipliers.image,
        usdCnyRate: policy.usdCnyRate,
      });
      amount += result.userCostPoints;
      tierCharges[tier] = {
        image_count: count,
        unit_price: unitPrice,
        currency,
        total_cost: result.userCostPoints,
      };
    }
    const chargeTiers = Object.keys(tierCharges);
    const singleTier = chargeTiers.length === 1 ? tierCharges[chargeTiers[0]] : null;
    return {
      amount,
      billingMode: 'image',
      snapshot: {
        mode: 'image', size, requested_size: String(context.request?.size || ''),
        input_size: sizeResolution.inputSize || '', output_size: sizeResolution.outputSize || '',
        size_source: sizeResolution.source, output_size_breakdown: actualBreakdown || {}, size_breakdown: tierCounts,
        image_count: requestedCount, unit_price: singleTier?.unit_price ?? null,
        currency: singleTier?.currency ?? 'mixed', tier_charges: tierCharges,
        multiplier: policy.multipliers.image, usd_cny_rate: policy.usdCnyRate,
      },
    };
  }

  reservationImageQuote(policy, context, imageCount) {
    const quotes = [this.imageQuote(policy, context, imageCount)];
    const size = quotes[0].snapshot.size;
    for (const configuration of policy.candidateConfigurations) {
      const mapped = jsonObject(configuration);
      const unitPrice = price(
        mapped[`image_price_${size.toLowerCase()}`],
        mapped[`image_price_${size.replace('K', 'k')}`],
      );
      if (!(unitPrice > 0)) continue;
      const result = calculateImagePricing({
        imageCount,
        unitPrice,
        currency: 'USD',
        multiplier: policy.multipliers.image,
        usdCnyRate: policy.usdCnyRate,
      });
      quotes.push({
        amount: result.userCostPoints,
        billingMode: 'image',
        snapshot: { mode: 'image', size, image_count: imageCount, unit_price: unitPrice, currency: 'USD', multiplier: policy.multipliers.image, usd_cny_rate: policy.usdCnyRate },
      });
    }
    return quotes.reduce((maximum, quote) => quote.amount > maximum.amount ? quote : maximum);
  }

  reservationTokenPolicy(policy) {
    const officialPerTokenUsd = value => {
      const amount = price(value);
      if (!(amount > 0)) return 0;
      const perToken = amount / policy.unitTokens;
      return String(policy.currency).toUpperCase() === 'USD' ? perToken : perToken / policy.usdCnyRate;
    };
    const mappedPrices = name => policy.candidateConfigurations.map(configuration => price(jsonObject(configuration)[name]));
    const input = Math.max(officialPerTokenUsd(policy.prices.input), ...mappedPrices('input_price'));
    const output = Math.max(officialPerTokenUsd(policy.prices.output), ...mappedPrices('output_price'));
    const cachedInput = Math.max(officialPerTokenUsd(policy.prices.cachedInput), ...mappedPrices('cache_read_price'), input);
    return { ...policy, currency: 'USD', unitTokens: 1, prices: { input, output, cachedInput } };
  }

  tokenQuote(policy, usage, serviceTier = '') {
    if (Number(usage.inputTokens || 0) > 0 && !(policy.prices.input > 0)) {
      const error = new Error(`Input price is unavailable for model ${policy.model}`);
      error.code = 'pricing_unavailable';
      error.status = 503;
      throw error;
    }
    if (Number(usage.outputTokens || 0) > 0 && !(policy.prices.output > 0)) {
      const error = new Error(`Output price is unavailable for model ${policy.model}`);
      error.code = 'pricing_unavailable';
      error.status = 503;
      throw error;
    }
    const result = calculatePricing({
      modelCode: policy.model,
      ...usage,
      official: {
        ...policy.prices,
        currency: policy.currency,
        unitTokens: policy.unitTokens,
      },
      multipliers: policy.multipliers,
      usdCnyRate: policy.usdCnyRate,
      serviceTier,
    });
    return {
      amount: result.userCostPoints,
      billingMode: 'token',
      snapshot: {
        mode: 'token', currency: policy.currency, unit_tokens: policy.unitTokens,
        input_price: policy.prices.input, output_price: policy.prices.output,
        cached_input_price: policy.prices.cachedInput,
        cache_creation_price: result.official.cacheCreationEffectivePrice,
        cache_creation_5m_price: policy.prices.cacheCreation5m
          ?? policy.prices.cacheCreation
          ?? result.official.cacheCreationEffectivePrice,
        cache_creation_1h_price: policy.prices.cacheCreation1h
          ?? policy.prices.cacheCreation
          ?? result.official.cacheCreationEffectivePrice,
        input_multiplier: policy.multipliers.input, output_multiplier: policy.multipliers.output,
        usd_cny_rate: policy.usdCnyRate,
        service_tier: serviceTier || '',
        usage: {
          input_tokens: result.official.inputTokens,
          uncached_input_tokens: result.official.uncachedInputTokens,
          cached_input_tokens: result.official.cachedInputTokens,
          cache_creation_tokens: result.official.cacheCreationTokens,
          cache_creation_5m_tokens: result.official.cacheCreation5mTokens,
          cache_creation_1h_tokens: result.official.cacheCreation1hTokens,
          image_input_tokens: result.official.imageInputTokens,
          output_tokens: result.official.outputTokens,
          image_output_tokens: result.official.imageOutputTokens,
        },
      },
    };
  }

  async quoteReservation(context) {
    const policy = await this.loadPolicy(context.model, context.identity?.routingGroupId, context.identity?.userId);
    if (this.isImage(context)) {
      const count = Math.max(1, Math.floor(numeric(context.request?.n, 1)));
      const quote = this.reservationImageQuote(policy, context, count);
      return { ...quote, amount: Math.max(quote.amount, this.minimumReservation), estimatedTokens: 0 };
    }
    const inputTokens = Math.max(1, Math.ceil(JSON.stringify(context.request || {}).length / 4));
    const noOutput = ['embeddings', 'anthropic_count_tokens'].includes(context.operation);
    const requestedOutput = noOutput ? 0 : positive(
      context.request?.max_output_tokens
      ?? context.request?.max_completion_tokens
      ?? context.request?.max_tokens,
      this.defaultOutputTokens,
    );
    const outputTokens = policy.contextLength > 0
      ? Math.max(0, Math.min(requestedOutput, policy.contextLength - inputTokens))
      : requestedOutput;
    let tokenQuote = null;
    const tokenPolicy = this.reservationTokenPolicy(policy);
    if ((inputTokens <= 0 || tokenPolicy.prices.input > 0)
      && (outputTokens <= 0 || tokenPolicy.prices.output > 0)) {
      tokenQuote = this.tokenQuote(tokenPolicy, { inputTokens, outputTokens }, context.request?.service_tier);
    }
    const perRequestUnit = Math.max(
      policy.perRequestPrice,
      ...policy.candidateConfigurations
        .filter(configuration => policy.billingMode === 'per_request'
          || jsonObject(configuration).billing_mode === 'per_request')
        .map(configuration => price(jsonObject(configuration).per_request_price)),
    );
    const perRequestAmount = perRequestUnit > 0
      ? perRequestUnit * policy.usdCnyRate * policy.multipliers.input
      : 0;
    if (!tokenQuote && !(perRequestAmount > 0)) {
      const error = new Error(`Price is unavailable for model ${policy.model}`);
      error.code = 'pricing_unavailable';
      error.status = 503;
      throw error;
    }
    const quote = tokenQuote && tokenQuote.amount >= perRequestAmount
      ? tokenQuote
      : {
        amount: perRequestAmount,
        billingMode: 'per_request',
        snapshot: { mode: 'per_request', unit_price: perRequestUnit, currency: 'USD', multiplier: policy.multipliers.input, usd_cny_rate: policy.usdCnyRate },
      };
    return {
      ...quote,
      amount: Math.max(quote.amount, this.minimumReservation),
      estimatedTokens: inputTokens + outputTokens,
    };
  }

  async quoteCharge(context) {
    const settlementRoutingGroupId = context.selection?.routingGroupId
      ?? context.identity?.routingGroupId;
    const policy = await this.loadPolicy(context.model, settlementRoutingGroupId, context.identity?.userId);
    if (this.isImage(context) || context.imageCount > 0) {
      return this.imageQuote(policy, context, Math.max(0, Number(context.imageCount || 0)));
    }
    const mapped = this.mappedConfiguration(context);
    if ((mapped.billing_mode || policy.billingMode) === 'per_request') {
      const unitPrice = price(mapped.per_request_price, policy.perRequestPrice);
      if (!(unitPrice > 0)) {
        const error = new Error(`Per-request price is unavailable for model ${policy.model}`);
        error.code = 'pricing_unavailable';
        error.status = 503;
        throw error;
      }
      return {
        amount: unitPrice * policy.usdCnyRate * policy.multipliers.input,
        billingMode: 'per_request',
        snapshot: { mode: 'per_request', unit_price: unitPrice, currency: 'USD', multiplier: policy.multipliers.input, usd_cny_rate: policy.usdCnyRate },
      };
    }
    const officialPerTokenUsd = value => {
      const amount = price(value);
      if (!(amount > 0)) return 0;
      const perToken = amount / policy.unitTokens;
      return String(policy.currency).toUpperCase() === 'USD'
        ? perToken
        : perToken / policy.usdCnyRate;
    };
    const input = price(mapped.input_price, officialPerTokenUsd(policy.prices.input));
    const output = price(mapped.output_price, officialPerTokenUsd(policy.prices.output));
    const officialCacheCreation = officialPerTokenUsd(policy.prices.cacheCreation);
    const officialCachePrices = {
      input: officialPerTokenUsd(policy.prices.input),
      cachedInput: officialPerTokenUsd(policy.prices.cachedInput),
      ...(officialCacheCreation > 0 ? { cacheCreation: officialCacheCreation } : {}),
      ...(officialPerTokenUsd(policy.prices.cacheCreation5m) > 0
        ? { cacheCreation5m: officialPerTokenUsd(policy.prices.cacheCreation5m) }
        : {}),
      ...(officialPerTokenUsd(policy.prices.cacheCreation1h) > 0
        ? { cacheCreation1h: officialPerTokenUsd(policy.prices.cacheCreation1h) }
        : {}),
    };
    const providerCachePrices = withProviderCachePricing(
      officialCachePrices,
      { official_provider: policy.officialProvider },
      {
        explicitCacheWrite: officialCacheCreation > 0,
        nativeAnthropic: context.operation === 'anthropic_messages',
      },
    );
    const hasOfficialCacheCreation = Number(providerCachePrices.cacheCreation) > 0;
    const useDerivedGptCacheCreation = String(policy.model || '').toLowerCase()
      .replace(/^openai\//, '').startsWith('gpt-5.6');
    const derivedGptCacheCreation = useDerivedGptCacheCreation
      && Number(officialCachePrices.input) > 0
      ? Number(officialCachePrices.input) * 1.25
      : 0;
    const cacheCreation = hasOfficialCacheCreation
      ? providerCachePrices.cacheCreation
      : derivedGptCacheCreation > 0
        ? derivedGptCacheCreation
        : price(mapped.cache_write_price, input);
    const effectivePolicy = {
      ...policy,
      currency: 'USD',
      unitTokens: 1,
      prices: {
        input,
        output,
        cachedInput: price(providerCachePrices.cachedInput, mapped.cache_read_price, input),
        cacheCreation,
        ...(Number(providerCachePrices.cacheCreation5m) > 0
          ? { cacheCreation5m: providerCachePrices.cacheCreation5m }
          : {}),
        ...(Number(providerCachePrices.cacheCreation1h) > 0
          ? { cacheCreation1h: providerCachePrices.cacheCreation1h }
          : {}),
        imageInput: price(mapped.image_input_price, input),
        imageOutput: price(mapped.image_output_price, output),
      },
    };
    return this.tokenQuote(effectivePolicy, context.usage || {}, context.request?.service_tier);
  }
}

module.exports = { PostgresProxyBillingPolicy, PostgresProxyRepository };
