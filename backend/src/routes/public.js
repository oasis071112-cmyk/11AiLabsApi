const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { listSystemModelCapabilities } = require('../utils/routing-group-models');

router.get('/info', (req, res) => {
  const db = getDatabase();
  const platformName = db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_name'").get();
  const announcement = db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_announcement'").get();
  const regEnabled = db.prepare("SELECT config_value FROM system_config WHERE config_key='registration_enabled'").get();
  const customerServiceText = db.prepare("SELECT config_value FROM system_config WHERE config_key='customer_service_text'").get();
  const customerServiceUrl = db.prepare("SELECT config_value FROM system_config WHERE config_key='customer_service_url'").get();
  res.json({
    platform_name: platformName?.config_value||'IonAiLabs',
    announcement: announcement?.config_value||'',
    registration_enabled: regEnabled?.config_value!=='false',
    customer_service_text: customerServiceText?.config_value||'',
    customer_service_url: customerServiceUrl?.config_value||''
  });
});

router.get('/models', (req, res) => {
  const db = getDatabase();
  const models = db.prepare("SELECT model_code,model_name,model_type,context_length,is_multimodal,billing_multiplier_input,billing_multiplier_output FROM models WHERE status='active' ORDER BY sort_order ASC").all();
  const capabilityByModel = listSystemModelCapabilities(db);
  res.json({ data: models.map(model => {
    const capabilities = capabilityByModel.get(model.model_code) || { chat_completions: false, image_input: false, image_generations: false, responses: false };
    return { ...model, is_multimodal: capabilities.image_input, supports_image_input: capabilities.image_input, capabilities };
  }) });
});

module.exports = router;
