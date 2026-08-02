BEGIN;

UPDATE upstream_accounts SET tpm_limit = 0;
ALTER TABLE upstream_accounts ALTER COLUMN tpm_limit SET DEFAULT 0;

INSERT INTO schema_migrations (version, checksum)
VALUES ('007_upstream_tpm_unlimited', 'upstream-tpm-unlimited-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
