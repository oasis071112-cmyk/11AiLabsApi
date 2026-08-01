BEGIN;

UPDATE upstream_accounts SET max_concurrency = 5;
ALTER TABLE upstream_accounts ALTER COLUMN max_concurrency SET DEFAULT 5;

INSERT INTO schema_migrations (version, checksum)
VALUES ('006_upstream_concurrency_default', 'upstream-concurrency-default-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
