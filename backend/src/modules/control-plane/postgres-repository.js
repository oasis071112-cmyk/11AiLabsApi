const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../infrastructure/postgres');

function accountKey(value) {
  const normalized = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `account-${randomUUID()}`;
}

class PostgresControlPlaneRepository {
  constructor(pool) {
    if (!pool?.query || !pool?.connect) throw new Error('PostgresControlPlaneRepository pool is required');
    this.pool = pool;
  }

  async getBootstrap() {
    const [accounts, models, accountModels, groups, groupAccounts, groupModels, pricing, config, payments] = await Promise.all([
      this.pool.query(`SELECT id,account_key,display_name AS name,base_url,protocol_type,capabilities,status,
        max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight,health_score,cooldown_until,
        latency_ms,last_probe_at,(api_key_envelope IS NOT NULL) AS secret_configured,created_at,updated_at
        FROM upstream_accounts ORDER BY priority ASC,id ASC`),
      this.pool.query('SELECT * FROM models ORDER BY model_code ASC'),
      this.pool.query(`SELECT account_id,model_code,upstream_model_name,supports_image_input,configuration,status
        FROM account_models ORDER BY account_id,model_code`),
      this.pool.query('SELECT * FROM routing_groups ORDER BY id ASC'),
      this.pool.query('SELECT * FROM routing_group_accounts ORDER BY routing_group_id,priority,account_id'),
      this.pool.query('SELECT * FROM routing_group_models ORDER BY routing_group_id,model_code'),
      this.pool.query("SELECT * FROM pricing_rules WHERE status='active' ORDER BY rule_key"),
      this.pool.query('SELECT config_key,config_value,description,updated_at FROM system_config ORDER BY config_key'),
      this.pool.query(`SELECT id,provider_code,provider_name,provider_type,status,
        (secret_envelope IS NOT NULL) AS secret_configured,config,created_at,updated_at
        FROM payment_providers ORDER BY id`),
    ]);
    return {
      accounts: accounts.rows,
      models: models.rows,
      account_models: accountModels.rows,
      routing_groups: groups.rows,
      group_accounts: groupAccounts.rows,
      group_models: groupModels.rows,
      pricing_rules: pricing.rows,
      system_config: config.rows,
      payment_providers: payments.rows,
    };
  }

  transaction(work) {
    return withTransaction(this.pool, async client => work({
      createAccount: account => this.createAccount(client, account),
      appendAudit: audit => this.appendAudit(client, audit),
    }));
  }

  async createAccount(client, account) {
    const secretVersion = String(account.credential_ciphertext).split('.')[0] || 'unknown';
    const { rows } = await client.query(`INSERT INTO upstream_accounts
      (account_key,display_name,base_url,protocol_type,api_key_envelope,secret_version,capabilities,status,
       max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id,account_key,display_name AS name,base_url,protocol_type,capabilities,status,
        max_concurrency,rpm_limit,tpm_limit,cooldown_seconds,priority,weight,created_at,updated_at`, [
      accountKey(account.account_key || account.name), account.name, account.base_url,
      account.protocol_type, account.credential_ciphertext, secretVersion,
      JSON.stringify(account.capabilities || []), account.status,
      account.max_concurrency, account.rpm_limit, account.tpm_limit,
      account.cooldown_seconds, account.priority, account.weight,
    ]);
    return rows[0];
  }

  appendAudit(client, audit) {
    return client.query(`INSERT INTO audit_logs
      (audit_key,action,actor_staff_user_id,payload,created_at) VALUES ($1,$2,$3,$4::jsonb,$5)`, [
      randomUUID(), audit.action, audit.actor_id,
      JSON.stringify({
        actor_role: audit.actor_role,
        target_type: audit.target_type,
        target_id: audit.target_id,
        ...audit.metadata,
      }),
      audit.created_at,
    ]);
  }
}

module.exports = { PostgresControlPlaneRepository };
