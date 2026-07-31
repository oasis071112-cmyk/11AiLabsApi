const express = require('express');

function configMap(rows) {
  return new Map((rows || []).map(row => [row.config_key, row.config_value]));
}

function createPostgresPublicRouter({ pool } = {}) {
  if (!pool?.query) throw new TypeError('PostgreSQL public router requires pool.query');
  const router = express.Router();

  router.get('/info', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT config_key,config_value FROM system_config
        WHERE config_key=ANY($1::text[])`, [[
        'platform_name', 'platform_announcement', 'registration_enabled',
        'customer_service_text', 'customer_service_url',
      ]]);
      const config = configMap(rows);
      res.json({
        platform_name: config.get('platform_name') ?? 'IonAiLabs',
        announcement: config.get('platform_announcement') ?? '',
        registration_enabled: config.get('registration_enabled') !== false,
        customer_service_text: config.get('customer_service_text') ?? 'QQ群：575334175',
        customer_service_url: config.get('customer_service_url') ?? '',
      });
    } catch (error) { next(error); }
  });

  router.get('/models', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`SELECT m.model_code,m.model_name,m.model_type,m.context_length,
        m.metadata->>'billing_multiplier_input' AS billing_multiplier_input,
        m.metadata->>'billing_multiplier_output' AS billing_multiplier_output,
        m.capabilities || jsonb_build_object(
          'image_input',EXISTS(SELECT 1 FROM account_models am JOIN upstream_accounts ua ON ua.id=am.account_id
            WHERE am.model_code=m.model_code AND am.status='active' AND ua.status='active' AND am.supports_image_input),
          'chat_completions',EXISTS(SELECT 1 FROM account_models am JOIN upstream_accounts ua ON ua.id=am.account_id
            WHERE am.model_code=m.model_code AND am.status='active' AND ua.status='active' AND ua.capabilities ? 'chat_completions'),
          'responses',EXISTS(SELECT 1 FROM account_models am JOIN upstream_accounts ua ON ua.id=am.account_id
            WHERE am.model_code=m.model_code AND am.status='active' AND ua.status='active' AND ua.capabilities ? 'responses'),
          'image_generations',EXISTS(SELECT 1 FROM account_models am JOIN upstream_accounts ua ON ua.id=am.account_id
            WHERE am.model_code=m.model_code AND am.status='active' AND ua.status='active' AND ua.capabilities ? 'image_generations'),
          'image_edits',EXISTS(SELECT 1 FROM account_models am JOIN upstream_accounts ua ON ua.id=am.account_id
            WHERE am.model_code=m.model_code AND am.status='active' AND am.supports_image_input=TRUE
              AND ua.status='active' AND ua.capabilities ? 'image_edits'),
          'image_variations',EXISTS(SELECT 1 FROM account_models am JOIN upstream_accounts ua ON ua.id=am.account_id
            WHERE am.model_code=m.model_code AND am.status='active' AND am.supports_image_input=TRUE
              AND ua.status='active' AND ua.capabilities ? 'image_variations'),
          'image_transformations',EXISTS(SELECT 1 FROM account_models am JOIN upstream_accounts ua ON ua.id=am.account_id
            WHERE am.model_code=m.model_code AND am.status='active' AND am.supports_image_input=TRUE
              AND ua.status='active' AND ua.capabilities ? 'image_transformations')
        ) AS capabilities
        FROM models m WHERE m.status='active' ORDER BY m.sort_order,m.model_code`);
      res.json({ data: rows.map(row => ({
        ...row,
        billing_multiplier_input: Number(row.billing_multiplier_input || 1),
        billing_multiplier_output: Number(row.billing_multiplier_output || 1),
        is_multimodal: Boolean(row.capabilities?.image_input),
        supports_image_input: Boolean(row.capabilities?.image_input),
      })) });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createPostgresPublicRouter };
