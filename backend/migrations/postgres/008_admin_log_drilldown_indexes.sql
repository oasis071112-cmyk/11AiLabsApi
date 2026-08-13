-- ionailabs:non-transactional
-- Partition indexes are built concurrently on live child tables, then attached
-- to metadata-only parent indexes so future partitions inherit the same shape.

CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at_desc
  ON ONLY api_request_logs (created_at DESC, id DESC);
SELECT format('DROP INDEX CONCURRENTLY %I.%I', namespace.nspname, index_class.relname)
FROM pg_class index_class
JOIN pg_namespace namespace ON namespace.oid=index_class.relnamespace
JOIN pg_index index_state ON index_state.indexrelid=index_class.oid
WHERE index_class.relname LIKE 'api_request_logs_%_created_at_desc_idx' AND NOT index_state.indisvalid
\gexec
SELECT format('CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.%I (created_at DESC, id DESC)',
  child.relname || '_created_at_desc_idx', namespace.nspname, child.relname)
FROM pg_inherits inheritance
JOIN pg_class child ON child.oid=inheritance.inhrelid
JOIN pg_namespace namespace ON namespace.oid=child.relnamespace
WHERE inheritance.inhparent='api_request_logs'::regclass
\gexec
SELECT format('ALTER INDEX %I.%I ATTACH PARTITION %I.%I',
  parent_namespace.nspname, 'idx_api_request_logs_created_at_desc', child_namespace.nspname, child_index.relname)
FROM pg_inherits table_inheritance
JOIN pg_class child ON child.oid=table_inheritance.inhrelid
JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
JOIN pg_class child_index ON child_index.relname=child.relname || '_created_at_desc_idx'
JOIN pg_namespace child_index_namespace ON child_index_namespace.oid=child_index.relnamespace
JOIN pg_class parent_index ON parent_index.relname='idx_api_request_logs_created_at_desc'
JOIN pg_namespace parent_namespace ON parent_namespace.oid=parent_index.relnamespace
WHERE table_inheritance.inhparent='api_request_logs'::regclass
  AND child_index_namespace.oid=child_namespace.oid
  AND NOT EXISTS (SELECT 1 FROM pg_inherits index_inheritance
    WHERE index_inheritance.inhparent=parent_index.oid AND index_inheritance.inhrelid=child_index.oid)
\gexec

CREATE INDEX IF NOT EXISTS idx_api_request_logs_model_created
  ON ONLY api_request_logs (model_code, created_at DESC, id DESC);
SELECT format('DROP INDEX CONCURRENTLY %I.%I', namespace.nspname, index_class.relname)
FROM pg_class index_class
JOIN pg_namespace namespace ON namespace.oid=index_class.relnamespace
JOIN pg_index index_state ON index_state.indexrelid=index_class.oid
WHERE index_class.relname LIKE 'api_request_logs_%_model_created_idx' AND NOT index_state.indisvalid
\gexec
SELECT format('CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.%I (model_code, created_at DESC, id DESC)',
  child.relname || '_model_created_idx', namespace.nspname, child.relname)
FROM pg_inherits inheritance
JOIN pg_class child ON child.oid=inheritance.inhrelid
JOIN pg_namespace namespace ON namespace.oid=child.relnamespace
WHERE inheritance.inhparent='api_request_logs'::regclass
\gexec
SELECT format('ALTER INDEX %I.%I ATTACH PARTITION %I.%I',
  parent_namespace.nspname, 'idx_api_request_logs_model_created', child_namespace.nspname, child_index.relname)
FROM pg_inherits table_inheritance
JOIN pg_class child ON child.oid=table_inheritance.inhrelid
JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
JOIN pg_class child_index ON child_index.relname=child.relname || '_model_created_idx'
JOIN pg_namespace child_index_namespace ON child_index_namespace.oid=child_index.relnamespace
JOIN pg_class parent_index ON parent_index.relname='idx_api_request_logs_model_created'
JOIN pg_namespace parent_namespace ON parent_namespace.oid=parent_index.relnamespace
WHERE table_inheritance.inhparent='api_request_logs'::regclass
  AND child_index_namespace.oid=child_namespace.oid
  AND NOT EXISTS (SELECT 1 FROM pg_inherits index_inheritance
    WHERE index_inheritance.inhparent=parent_index.oid AND index_inheritance.inhrelid=child_index.oid)
\gexec

CREATE INDEX IF NOT EXISTS idx_api_request_logs_status_created
  ON ONLY api_request_logs (status, created_at DESC, id DESC);
SELECT format('DROP INDEX CONCURRENTLY %I.%I', namespace.nspname, index_class.relname)
FROM pg_class index_class
JOIN pg_namespace namespace ON namespace.oid=index_class.relnamespace
JOIN pg_index index_state ON index_state.indexrelid=index_class.oid
WHERE index_class.relname LIKE 'api_request_logs_%_status_created_idx' AND NOT index_state.indisvalid
\gexec
SELECT format('CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.%I (status, created_at DESC, id DESC)',
  child.relname || '_status_created_idx', namespace.nspname, child.relname)
FROM pg_inherits inheritance
JOIN pg_class child ON child.oid=inheritance.inhrelid
JOIN pg_namespace namespace ON namespace.oid=child.relnamespace
WHERE inheritance.inhparent='api_request_logs'::regclass
\gexec
SELECT format('ALTER INDEX %I.%I ATTACH PARTITION %I.%I',
  parent_namespace.nspname, 'idx_api_request_logs_status_created', child_namespace.nspname, child_index.relname)
FROM pg_inherits table_inheritance
JOIN pg_class child ON child.oid=table_inheritance.inhrelid
JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
JOIN pg_class child_index ON child_index.relname=child.relname || '_status_created_idx'
JOIN pg_namespace child_index_namespace ON child_index_namespace.oid=child_index.relnamespace
JOIN pg_class parent_index ON parent_index.relname='idx_api_request_logs_status_created'
JOIN pg_namespace parent_namespace ON parent_namespace.oid=parent_index.relnamespace
WHERE table_inheritance.inhparent='api_request_logs'::regclass
  AND child_index_namespace.oid=child_namespace.oid
  AND NOT EXISTS (SELECT 1 FROM pg_inherits index_inheritance
    WHERE index_inheritance.inhparent=parent_index.oid AND index_inheritance.inhrelid=child_index.oid)
\gexec

CREATE INDEX IF NOT EXISTS idx_api_request_logs_upstream_created
  ON ONLY api_request_logs (upstream_account_id, created_at DESC, id DESC);
SELECT format('DROP INDEX CONCURRENTLY %I.%I', namespace.nspname, index_class.relname)
FROM pg_class index_class
JOIN pg_namespace namespace ON namespace.oid=index_class.relnamespace
JOIN pg_index index_state ON index_state.indexrelid=index_class.oid
WHERE index_class.relname LIKE 'api_request_logs_%_upstream_created_idx' AND NOT index_state.indisvalid
\gexec
SELECT format('CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.%I (upstream_account_id, created_at DESC, id DESC)',
  child.relname || '_upstream_created_idx', namespace.nspname, child.relname)
FROM pg_inherits inheritance
JOIN pg_class child ON child.oid=inheritance.inhrelid
JOIN pg_namespace namespace ON namespace.oid=child.relnamespace
WHERE inheritance.inhparent='api_request_logs'::regclass
\gexec
SELECT format('ALTER INDEX %I.%I ATTACH PARTITION %I.%I',
  parent_namespace.nspname, 'idx_api_request_logs_upstream_created', child_namespace.nspname, child_index.relname)
FROM pg_inherits table_inheritance
JOIN pg_class child ON child.oid=table_inheritance.inhrelid
JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
JOIN pg_class child_index ON child_index.relname=child.relname || '_upstream_created_idx'
JOIN pg_namespace child_index_namespace ON child_index_namespace.oid=child_index.relnamespace
JOIN pg_class parent_index ON parent_index.relname='idx_api_request_logs_upstream_created'
JOIN pg_namespace parent_namespace ON parent_namespace.oid=parent_index.relnamespace
WHERE table_inheritance.inhparent='api_request_logs'::regclass
  AND child_index_namespace.oid=child_namespace.oid
  AND NOT EXISTS (SELECT 1 FROM pg_inherits index_inheritance
    WHERE index_inheritance.inhparent=parent_index.oid AND index_inheritance.inhrelid=child_index.oid)
\gexec

INSERT INTO schema_migrations (version, checksum)
VALUES ('008_admin_log_drilldown_indexes', 'admin-log-drilldown-indexes-v1')
ON CONFLICT (version) DO NOTHING;
