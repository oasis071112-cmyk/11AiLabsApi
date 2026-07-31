BEGIN;

-- Preserve the legacy daily-stats API key filter without scanning monthly log
-- partitions. The general user_daily_usage table remains the cheaper path for
-- unfiltered dashboard reads.
CREATE TABLE IF NOT EXISTS user_api_key_daily_usage (
  usage_date DATE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  model_code TEXT NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  total_cost NUMERIC(18, 6) NOT NULL DEFAULT 0,
  success_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  blocked_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, user_id, api_key_id, model_code)
);

CREATE INDEX IF NOT EXISTS idx_user_api_key_daily_usage_user_date
  ON user_api_key_daily_usage (user_id, usage_date DESC);

INSERT INTO schema_migrations (version, checksum)
VALUES ('004_api_key_daily_usage', 'api-key-daily-usage-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
