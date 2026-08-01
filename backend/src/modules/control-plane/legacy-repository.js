const { randomUUID } = require('node:crypto');

function parseCapabilities(value) {
  try { return Array.isArray(value) ? value : JSON.parse(value || '[]'); } catch (_error) { return []; }
}

class LegacyControlPlaneRepository {
  constructor(db) {
    if (!db?.prepare || !db?.transaction) throw new Error('LegacyControlPlaneRepository database is required');
    this.db = db;
  }

  async getBootstrap() {
    const accounts = this.db.prepare(`SELECT id,channel_name AS name,base_url,protocol_type,capabilities,status,
      priority,weight,max_concurrency,health_score,circuit_breaker_until AS cooldown_until,last_check_time AS last_probe_at,
      (api_key IS NOT NULL AND api_key!='') AS secret_configured,created_at,updated_at
      FROM upstream_channels ORDER BY priority ASC,id ASC`).all().map(account => ({
      ...account,
      capabilities: parseCapabilities(account.capabilities),
      rpm_limit: 0,
      tpm_limit: 0,
      cooldown_seconds: 60,
    }));
    return {
      accounts,
      models: this.db.prepare('SELECT * FROM models ORDER BY model_code').all(),
      account_models: this.db.prepare(`SELECT channel_id AS account_id,model_code,upstream_model_name,
        supports_image_input,status FROM channel_models ORDER BY channel_id,model_code`).all(),
      routing_groups: this.db.prepare('SELECT * FROM routing_groups ORDER BY id').all(),
      group_accounts: this.db.prepare(`SELECT group_id AS routing_group_id,channel_id AS account_id,
        priority,weight,status FROM routing_group_channels ORDER BY group_id,priority,channel_id`).all(),
      group_models: this.db.prepare(`SELECT group_id AS routing_group_id,model_code,status,
        billing_multiplier_input,billing_multiplier_output,billing_multiplier_image
        FROM routing_group_models ORDER BY group_id,model_code`).all(),
      pricing_rules: this.db.prepare('SELECT * FROM pricing_rules ORDER BY priority DESC,id').all(),
      system_config: this.db.prepare('SELECT * FROM system_config ORDER BY config_key').all(),
      payment_providers: this.db.prepare(`SELECT id,provider_name,provider_type,status,created_at,updated_at,
        (merchant_key_encrypted IS NOT NULL AND merchant_key_encrypted!='') AS secret_configured
        FROM payment_providers ORDER BY id`).all(),
    };
  }

  async transaction(work) {
    // SQL.js cannot hold a transaction across an async callback. This adapter exists only for
    // local rollback compatibility; production PostgreSQL uses a real async transaction.
    return work({
      createAccount: async account => {
        const result = this.db.prepare(`INSERT INTO upstream_channels
          (channel_name,base_url,api_key,priority,weight,max_concurrency,protocol_type,capabilities,status)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(
          account.name, account.base_url, account.credential_ciphertext,
          account.priority, account.weight, account.max_concurrency, account.protocol_type,
          JSON.stringify(account.capabilities), account.status,
        );
        return { id: result.lastInsertRowid, ...account };
      },
      appendAudit: async audit => {
        this.db.prepare(`INSERT INTO audit_logs
          (user_id,action,target_type,target_id,detail,created_at)
          VALUES (?,?,?,?,?,?)`).run(
          audit.actor_id, audit.action, audit.target_type, audit.target_id,
          JSON.stringify({ audit_key: randomUUID(), ...audit.metadata }), audit.created_at,
        );
      },
    });
  }
}

module.exports = { LegacyControlPlaneRepository };
