BEGIN;

-- 账号池运行时调度与探针状态。0 表示未设置该配额上限。
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS max_concurrency INTEGER NOT NULL DEFAULT 1;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS rpm_limit INTEGER NOT NULL DEFAULT 60;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS tpm_limit INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER NOT NULL DEFAULT 60;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 100;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS health_score NUMERIC(5, 2) NOT NULL DEFAULT 100;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS last_probe_at TIMESTAMPTZ;
ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_upstream_accounts_runtime_selection
  ON upstream_accounts (status, cooldown_until, priority ASC, id ASC);

-- 钱包与统一结算账本字段。
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_spent NUMERIC(18, 6) NOT NULL DEFAULT 0;
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_quota_balance_check;
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_gift_quota_check;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_type TEXT NOT NULL DEFAULT 'quota';
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS before_balance NUMERIC(18, 6);
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS after_balance NUMERIC(18, 6);
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS related_request_id TEXT;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS remark TEXT;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_related_request
  ON wallet_transactions (related_request_id) WHERE related_request_id IS NOT NULL;

-- 分区日志的结算、失败和图片/协议审计快照。
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'token';
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS error_type TEXT;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS pending_reserved_amount NUMERIC(18, 6) NOT NULL DEFAULT 0;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS image_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS protocol_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 路由组回退、白名单与按维度倍率。
ALTER TABLE routing_groups ADD COLUMN IF NOT EXISTS fallback_group_id BIGINT REFERENCES routing_groups(id);
ALTER TABLE routing_groups ADD COLUMN IF NOT EXISTS restrict_models BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE routing_group_models ADD COLUMN IF NOT EXISTS billing_multiplier_input NUMERIC(18, 6);
ALTER TABLE routing_group_models ADD COLUMN IF NOT EXISTS billing_multiplier_output NUMERIC(18, 6);
ALTER TABLE routing_group_models ADD COLUMN IF NOT EXISTS billing_multiplier_image NUMERIC(18, 6);

CREATE INDEX IF NOT EXISTS idx_routing_groups_fallback ON routing_groups (fallback_group_id)
  WHERE fallback_group_id IS NOT NULL;

INSERT INTO schema_migrations (version, checksum)
VALUES ('002_runtime_limits_and_billing', 'runtime-limits-and-billing-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
