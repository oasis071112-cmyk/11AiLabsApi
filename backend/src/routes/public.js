const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { listSystemModelCapabilities } = require('../utils/routing-group-models');

router.get('/info', (req, res) => {
  const db = getDatabase();
  const platformName = db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_name'").get();
  const announcement = db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_announcement'").get();
  const regEnabled = db.prepare("SELECT config_value FROM system_config WHERE config_key='registration_enabled'").get();
  res.json({ platform_name: platformName?.config_value||'11AiLabs', announcement: announcement?.config_value||'', registration_enabled: regEnabled?.config_value!=='false' });
});

router.get('/models', (req, res) => {
  const db = getDatabase();
  const models = db.prepare("SELECT model_code,model_name,model_type,context_length,is_multimodal,billing_multiplier_input,billing_multiplier_output FROM models WHERE status='active' ORDER BY sort_order ASC").all();
  const capabilityByModel = listSystemModelCapabilities(db);
  res.json({ data: models.map(model => {
    const capabilities = capabilityByModel.get(model.model_code) || { chat_completions: false, image_input: false };
    return { ...model, is_multimodal: capabilities.image_input, supports_image_input: capabilities.image_input, capabilities };
  }) });
});

module.exports = router;
