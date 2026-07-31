BEGIN;

-- Public API identity/profile compatibility. User-plane rows are intentionally
-- created only in PostgreSQL after cutover; the control-plane importer never
-- copies ordinary users from SQL.js.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS register_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_time TIMESTAMPTZ;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS routing_group_id BIGINT REFERENCES routing_groups(id);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS permission_mode TEXT NOT NULL DEFAULT 'group_dynamic';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS max_spend_limit NUMERIC(18, 6);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS total_spent NUMERIC(18, 6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix_active
  ON api_keys (key_prefix) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_api_keys_user_active
  ON api_keys (user_id, created_at DESC) WHERE status!='revoked';

-- Model and routing-group fields consumed by the compatibility/read-model APIs.
ALTER TABLE models ADD COLUMN IF NOT EXISTS context_length INTEGER;
ALTER TABLE models ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE models ADD COLUMN IF NOT EXISTS official_provider TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS official_currency TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS official_input_price NUMERIC(24, 12);
ALTER TABLE models ADD COLUMN IF NOT EXISTS official_output_price NUMERIC(24, 12);
ALTER TABLE models ADD COLUMN IF NOT EXISTS official_cached_input_price NUMERIC(24, 12);
ALTER TABLE models ADD COLUMN IF NOT EXISTS official_unit_tokens BIGINT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS official_price_updated_at TIMESTAMPTZ;

ALTER TABLE routing_groups ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE routing_groups ADD COLUMN IF NOT EXISTS billing_multiplier_input NUMERIC(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE routing_groups ADD COLUMN IF NOT EXISTS billing_multiplier_output NUMERIC(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE routing_groups ADD COLUMN IF NOT EXISTS billing_multiplier_image NUMERIC(18, 6) NOT NULL DEFAULT 1;

ALTER TABLE account_models ADD COLUMN IF NOT EXISTS interface_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Status counters keep dashboard reads on the daily read model instead of
-- rescanning monthly request-log partitions.
ALTER TABLE user_daily_usage ADD COLUMN IF NOT EXISTS success_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_daily_usage ADD COLUMN IF NOT EXISTS failed_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_daily_usage ADD COLUMN IF NOT EXISTS blocked_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE platform_daily_usage ADD COLUMN IF NOT EXISTS success_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE platform_daily_usage ADD COLUMN IF NOT EXISTS failed_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE platform_daily_usage ADD COLUMN IF NOT EXISTS blocked_count BIGINT NOT NULL DEFAULT 0;

-- Stable operation fields keep log readers independent from provider-specific
-- metadata. Sensitive request or image content must never be stored here.
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS endpoint TEXT;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS operation TEXT;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS output_items INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS final_size TEXT;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS output_format TEXT;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS output_compression INTEGER;

-- A request-scoped reservation is the idempotency boundary for freeze, settle,
-- release and manual reconciliation. It prevents client retries from charging
-- or freezing a wallet twice.
CREATE TABLE IF NOT EXISTS usage_reservations (
  request_id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  api_key_id BIGINT REFERENCES api_keys(id),
  reserved_amount NUMERIC(18, 6) NOT NULL CHECK (reserved_amount >= 0),
  charged_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'released', 'pending_review')),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_reservations_pending
  ON usage_reservations (updated_at) WHERE status='pending_review';

-- Durable probe history complements the hot Redis counters. Runtime lease and
-- cooldown counters remain Redis-only and are deliberately not imported.
CREATE TABLE IF NOT EXISTS upstream_account_probes (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES upstream_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'failed')),
  latency_ms INTEGER,
  http_status INTEGER,
  error_code TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upstream_account_probes_account_checked
  ON upstream_account_probes (account_id, checked_at DESC);

-- Order compatibility fields. Payment stays disabled after import and may only
-- be re-enabled explicitly after the administrator validates the new database.
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS order_no TEXT;
UPDATE quota_orders SET order_no=order_key WHERE order_no IS NULL;
ALTER TABLE quota_orders ALTER COLUMN order_no SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_orders_order_no ON quota_orders (order_no);
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS payment_channel TEXT;
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS payment_proof TEXT;
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS admin_remark TEXT;
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS provider_trade_no TEXT;
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(18, 6);
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ;
ALTER TABLE quota_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE quota_orders DROP CONSTRAINT IF EXISTS quota_orders_status_check;
ALTER TABLE quota_orders ADD CONSTRAINT quota_orders_status_check
  CHECK (status IN ('pending', 'paid', 'granted', 'rejected', 'abnormal', 'cancelled', 'expired', 'refunded'));

ALTER TABLE payment_providers ADD COLUMN IF NOT EXISTS enabled_methods JSONB NOT NULL DEFAULT '[]'::jsonb;

-- A provider callback may race or be retried. Keep the order and ledger
-- idempotency boundary in PostgreSQL in addition to the row locks used by the
-- payment service.
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS related_order_id BIGINT REFERENCES quota_orders(id);
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS operator_id BIGINT REFERENCES staff_users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_purchase_order
  ON wallet_transactions (related_order_id)
  WHERE transaction_type='purchase' AND related_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_orders_provider_trade
  ON quota_orders (payment_provider_id, provider_trade_no)
  WHERE provider_trade_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quota_orders_granted_at
  ON quota_orders (granted_at) WHERE status='granted';

INSERT INTO system_config (config_key, config_value, description) VALUES
  ('registration_enabled', 'false'::jsonb, 'Public user registration switch; enable only after cutover validation'),
  ('new_user_gift_enabled', 'false'::jsonb, 'New-user gift switch'),
  ('new_user_gift_amount', '0'::jsonb, 'New-user gift amount'),
  ('payment_min_amount', '1'::jsonb, 'Minimum payment amount'),
  ('payment_max_amount', '10000'::jsonb, 'Maximum payment amount')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO schema_migrations (version, checksum)
VALUES ('003_public_api_compatibility', 'public-api-compatibility-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
