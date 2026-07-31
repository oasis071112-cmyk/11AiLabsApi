BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum TEXT NOT NULL DEFAULT ''
);

INSERT INTO schema_migrations (version, checksum)
VALUES ('000_bootstrap', 'postgres-foundation-bootstrap-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
