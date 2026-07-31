function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapAccountRows(rows) {
  const accounts = new Map();
  for (const row of rows || []) {
    let account = accounts.get(row.id);
    if (!account) {
      account = {
        id: row.id,
        accountKey: row.account_key,
        displayName: row.display_name,
        baseUrl: row.base_url,
        protocol: row.protocol_type,
        credentialEnvelope: row.api_key_envelope,
        secretVersion: row.secret_version,
        capabilities: parseJson(row.capabilities, []),
        status: row.account_status,
        groupIds: [],
        priority: numberValue(row.routing_priority, numberValue(row.account_priority)),
        weight: numberValue(row.routing_weight, numberValue(row.account_weight, 100)),
        healthScore: numberValue(row.health_score, 100),
        cooldownUntil: row.cooldown_until,
        cooldownSeconds: numberValue(row.cooldown_seconds),
        maxConcurrency: numberValue(row.max_concurrency),
        rpmLimit: numberValue(row.rpm_limit),
        tpmLimit: numberValue(row.tpm_limit),
        modelMappings: [],
      };
      accounts.set(row.id, account);
    }
    if (row.routing_group_id !== null && row.routing_group_id !== undefined
        && !account.groupIds.includes(String(row.routing_group_id))) {
      account.groupIds.push(String(row.routing_group_id));
    }
    if (row.model_code && !account.modelMappings.some(mapping => mapping.model === row.model_code)) {
      account.modelMappings.push({
        model: row.model_code,
        upstreamModel: row.upstream_model_name,
        supportsImageInput: Boolean(row.supports_image_input),
        configuration: parseJson(row.model_configuration, {}),
        status: row.model_status,
      });
    }
  }
  return [...accounts.values()];
}

class PostgresAccountRepository {
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('PostgresAccountRepository pool.query is required');
    }
    this.pool = pool;
  }

  async listCandidates({ groupId = null, model, protocol = null, capability = null }) {
    if (groupId !== null && groupId !== undefined) {
      const { rows } = await this.pool.query(`
        SELECT ua.id,ua.account_key,ua.display_name,ua.base_url,ua.protocol_type,
          ua.api_key_envelope,ua.secret_version,ua.capabilities,ua.status AS account_status,
          ua.max_concurrency,ua.rpm_limit,ua.tpm_limit,ua.cooldown_seconds,
          ua.priority AS account_priority,ua.weight AS account_weight,ua.health_score,ua.cooldown_until,
          rga.routing_group_id,rga.priority AS routing_priority,rga.weight AS routing_weight,
          am.model_code,am.upstream_model_name,am.supports_image_input,
          am.configuration AS model_configuration,am.status AS model_status
        FROM routing_group_accounts rga
        JOIN routing_groups rg ON rg.id=rga.routing_group_id
        JOIN upstream_accounts ua ON ua.id=rga.account_id
        JOIN account_models am ON am.account_id=ua.id
        WHERE rga.routing_group_id=$1 AND rg.status='active' AND rga.status='active'
          AND ua.status='active' AND am.status='active' AND am.model_code=$2
          AND ($3::text IS NULL OR ua.protocol_type=$3)
          AND ($4::text IS NULL OR ua.capabilities ? $4)
          AND (rg.restrict_models=FALSE OR EXISTS (
            SELECT 1 FROM routing_group_models rgm
            WHERE rgm.routing_group_id=rg.id AND rgm.model_code=am.model_code
              AND rgm.status='active'
          ))
        ORDER BY rga.priority ASC,ua.health_score DESC,rga.weight DESC,ua.id ASC
      `, [groupId, model, protocol, capability]);
      return mapAccountRows(rows);
    }

    const { rows } = await this.pool.query(`
      SELECT ua.id,ua.account_key,ua.display_name,ua.base_url,ua.protocol_type,
        ua.api_key_envelope,ua.secret_version,ua.capabilities,ua.status AS account_status,
        ua.max_concurrency,ua.rpm_limit,ua.tpm_limit,ua.cooldown_seconds,
        ua.priority AS account_priority,ua.weight AS account_weight,ua.health_score,ua.cooldown_until,
        NULL::bigint AS routing_group_id,ua.priority AS routing_priority,ua.weight AS routing_weight,
        am.model_code,am.upstream_model_name,am.supports_image_input,
        am.configuration AS model_configuration,am.status AS model_status
      FROM upstream_accounts ua
      JOIN account_models am ON am.account_id=ua.id
      WHERE ua.status='active' AND am.status='active' AND am.model_code=$1
        AND ($2::text IS NULL OR ua.protocol_type=$2)
        AND ($3::text IS NULL OR ua.capabilities ? $3)
      ORDER BY ua.priority ASC,ua.health_score DESC,ua.weight DESC,ua.id ASC
    `, [model, protocol, capability]);
    return mapAccountRows(rows);
  }

  async getFallbackGroupId(groupId) {
    const { rows } = await this.pool.query(
      `SELECT fallback_group_id FROM routing_groups WHERE id=$1 AND status='active'`,
      [groupId],
    );
    return rows[0]?.fallback_group_id ?? null;
  }

  async reportHealth({ accountId, success }) {
    await this.pool.query(`
      UPDATE upstream_accounts
      SET health_score=CASE WHEN $2::boolean
          THEN LEAST(100,health_score+1)
          ELSE GREATEST(0,health_score-10)
        END,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `, [accountId, Boolean(success)]);
  }

  async markCooldown({ accountId, cooldownUntil }) {
    await this.pool.query(`
      UPDATE upstream_accounts
      SET cooldown_until=GREATEST(COALESCE(cooldown_until,'-infinity'::timestamptz),$2::timestamptz),
        updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `, [accountId, new Date(cooldownUntil).toISOString()]);
  }
}

module.exports = { PostgresAccountRepository, mapAccountRows };
