const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../infrastructure/postgres');

const WALLET_FIELDS = new Set(['quota_balance', 'gift_quota', 'frozen_balance', 'total_spent']);
const LOG_FIELDS = new Set([
  'request_id', 'user_id', 'api_key_id', 'model_code', 'upstream_account_id', 'status',
  'latency_ms', 'input_tokens', 'output_tokens', 'total_cost', 'billing_mode', 'error_type',
  'error_message', 'pending_reserved_amount', 'billing_snapshot',
  'image_metadata', 'protocol_metadata', 'endpoint', 'operation', 'output_items',
  'final_size', 'output_format', 'output_compression',
]);

class PostgresSettlementRepository {
  constructor(pool) {
    if (!pool?.connect) throw new Error('PostgresSettlementRepository pool is required');
    this.pool = pool;
  }

  transaction(work) {
    return withTransaction(this.pool, async client => work({
      lockWallet: userId => this.lockWallet(client, userId),
      updateWallet: (userId, values) => this.updateWallet(client, userId, values),
      appendWalletTransaction: value => this.appendWalletTransaction(client, value),
      appendRequestLog: value => this.appendRequestLog(client, value),
      updateRequestLog: (identity, value) => this.updateRequestLog(client, identity, value),
      getOrCreateReservation: value => this.getOrCreateReservation(client, value),
      lockReservation: requestId => this.lockReservation(client, requestId),
      updateReservation: (requestId, values) => this.updateReservation(client, requestId, values),
    }));
  }

  async getOrCreateReservation(client, { requestId, userId, apiKeyId, reservedAmount }) {
    const inserted = await client.query(`INSERT INTO usage_reservations
      (request_id,user_id,api_key_id,reserved_amount,status)
      VALUES ($1,$2,$3,$4,'reserved') ON CONFLICT (request_id) DO NOTHING`,
    [requestId, userId, apiKeyId, reservedAmount]);
    const reservation = await this.lockReservation(client, requestId);
    return { reservation, created: inserted.rowCount === 1 };
  }

  async lockReservation(client, requestId) {
    const { rows } = await client.query(`SELECT request_id,user_id,api_key_id,reserved_amount,
      charged_amount,status,result FROM usage_reservations WHERE request_id=$1 FOR UPDATE`, [requestId]);
    return rows[0] || null;
  }

  updateReservation(client, requestId, values) {
    const allowed = new Set(['status', 'charged_amount', 'result']);
    const entries = Object.entries(values).filter(([key]) => allowed.has(key));
    if (entries.length === 0) return Promise.resolve();
    const assignments = entries.map(([key], index) =>
      `${key}=$${index + 2}${key === 'result' ? '::jsonb' : ''}`);
    return client.query(`UPDATE usage_reservations SET ${assignments.join(',')},
      updated_at=CURRENT_TIMESTAMP WHERE request_id=$1`, [
      requestId,
      ...entries.map(([key, value]) => key === 'result' ? JSON.stringify(value) : value),
    ]);
  }

  async lockWallet(client, userId) {
    const { rows } = await client.query(`SELECT user_id,quota_balance,gift_quota,frozen_balance,total_spent
      FROM wallets WHERE user_id=$1 FOR UPDATE`, [userId]);
    if (!rows[0]) throw new Error('钱包不存在');
    return rows[0];
  }

  updateWallet(client, userId, values) {
    const entries = Object.entries(values).filter(([key]) => WALLET_FIELDS.has(key));
    if (entries.length === 0) return Promise.resolve();
    const assignments = entries.map(([key], index) => `${key}=$${index + 2}`);
    return client.query(`UPDATE wallets SET ${assignments.join(',')},updated_at=CURRENT_TIMESTAMP WHERE user_id=$1`, [
      userId, ...entries.map(([, value]) => value),
    ]);
  }

  appendWalletTransaction(client, value) {
    return client.query(`INSERT INTO wallet_transactions
      (user_id,transaction_key,transaction_type,balance_type,amount,before_balance,after_balance,
       related_request_id,remark,balance_after,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,$10::jsonb)`, [
      value.user_id, randomUUID(), value.transaction_type, value.balance_type, value.amount,
      value.before_balance, value.after_balance, value.related_request_id, value.remark,
      JSON.stringify({}),
    ]);
  }

  appendRequestLog(client, value) {
    const known = Object.fromEntries(Object.entries(value).filter(([key]) => LOG_FIELDS.has(key)));
    const metadata = Object.fromEntries(Object.entries(value).filter(([key]) => !LOG_FIELDS.has(key)));
    const columns = [...Object.keys(known), 'metadata'];
    const values = [...Object.values(known), JSON.stringify(metadata)];
    const parameters = values.map((_, index) => `$${index + 1}${index === values.length - 1 ? '::jsonb' : ''}`);
    return client.query(`INSERT INTO api_request_logs (${columns.join(',')}) VALUES (${parameters.join(',')})`, values);
  }

  updateRequestLog(client, identity, value) {
    const known = Object.fromEntries(Object.entries(value).filter(([key]) => LOG_FIELDS.has(key)));
    const entries = Object.entries(known);
    if (entries.length === 0) return Promise.resolve();
    const exactIdentity = identity && typeof identity === 'object'
      && identity.id !== undefined && identity.createdAt;
    const whereValues = exactIdentity
      ? [identity.id, identity.createdAt]
      : [String(identity?.requestId || identity)];
    const assignments = entries.map(([key], index) => key === 'billing_snapshot'
      ? `billing_snapshot=COALESCE(billing_snapshot,'{}'::jsonb) || $${index + whereValues.length + 1}::jsonb`
      : `${key}=$${index + whereValues.length + 1}`);
    return client.query(`UPDATE api_request_logs SET ${assignments.join(',')}
      WHERE ${exactIdentity ? 'id=$1 AND created_at=$2::timestamptz' : 'request_id=$1'}`, [
      ...whereValues,
      ...entries.map(([key, item]) => key === 'billing_snapshot' ? JSON.stringify(item) : item),
    ]);
  }
}

module.exports = { PostgresSettlementRepository };
