import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(import.meta.dirname, '../migrations/postgres');
const require = createRequire(import.meta.url);
const { discoverMigrations } = require('../scripts/migrate-postgres.js');

describe('PostgreSQL foundation schema seam', () => {
  it('declares version tracking, the stable planes, monthly request partitions, and daily aggregates', () => {
    const bootstrap = fs.readFileSync(path.join(migrationsDirectory, '000_bootstrap.sql'), 'utf8');
    const schema = fs.readFileSync(path.join(migrationsDirectory, '001_foundation.sql'), 'utf8');

    expect(bootstrap).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    for (const table of [
      'staff_users', 'users', 'upstream_accounts', 'account_models', 'routing_groups',
      'routing_group_accounts', 'routing_group_models', 'models', 'pricing_rules',
      'system_config', 'payment_providers', 'api_keys', 'api_key_permissions', 'wallets',
      'wallet_transactions', 'quota_orders', 'api_request_logs', 'user_daily_usage',
      'platform_daily_usage', 'audit_logs',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(schema).toContain('PARTITION BY RANGE (created_at)');
    expect(schema).toContain('ensure_api_request_logs_partition');
    expect(schema).toContain("VALUES ('001_foundation'");
  });

  it('keeps the published foundation immutable and adds runtime compatibility in migration 002', () => {
    const foundation = fs.readFileSync(path.join(migrationsDirectory, '001_foundation.sql'), 'utf8');
    const runtimeCompatibility = fs.readFileSync(path.join(migrationsDirectory, '002_runtime_limits_and_billing.sql'), 'utf8');
    const { migrations } = discoverMigrations(migrationsDirectory);

    expect(migrations.map(migration => migration.version)).toEqual([
      '001_foundation',
      '002_runtime_limits_and_billing',
      '003_public_api_compatibility',
      '004_api_key_daily_usage',
    ]);
    expect(foundation).not.toContain('max_concurrency');
    for (const column of [
      'max_concurrency', 'rpm_limit', 'tpm_limit', 'cooldown_seconds', 'priority', 'weight',
      'health_score', 'cooldown_until', 'last_probe_at', 'latency_ms', 'total_spent',
      'balance_type', 'before_balance', 'after_balance', 'related_request_id', 'remark',
      'billing_mode', 'error_type', 'error_message', 'pending_reserved_amount',
      'image_metadata', 'protocol_metadata', 'fallback_group_id', 'restrict_models',
      'billing_multiplier_input', 'billing_multiplier_output', 'billing_multiplier_image',
    ]) {
      expect(runtimeCompatibility).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(runtimeCompatibility).toContain("VALUES ('002_runtime_limits_and_billing'");
  });

  it('adds the public compatibility columns and an idempotent usage reservation ledger in migration 003', () => {
    const compatibility = fs.readFileSync(path.join(migrationsDirectory, '003_public_api_compatibility.sql'), 'utf8');

    for (const column of [
      'phone', 'register_ip', 'last_login_ip', 'register_time', 'last_login_time',
      'routing_group_id', 'permission_mode', 'expired_at', 'rate_limit_per_minute',
      'max_spend_limit', 'context_length', 'sort_order', 'capabilities', 'description',
      'billing_multiplier_input', 'billing_multiplier_output', 'billing_multiplier_image',
      'success_count', 'failed_count', 'blocked_count',
      'endpoint', 'operation', 'output_items', 'final_size', 'output_format', 'output_compression',
      'order_no', 'payment_method', 'provider_trade_no', 'paid_amount', 'paid_at', 'granted_at', 'expires_at',
      'related_order_id', 'operator_id',
    ]) {
      expect(compatibility).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(compatibility).toContain('CREATE TABLE IF NOT EXISTS usage_reservations');
    expect(compatibility).toContain('request_id TEXT PRIMARY KEY');
    expect(compatibility).toContain('CREATE TABLE IF NOT EXISTS upstream_account_probes');
    expect(compatibility).toContain('idx_wallet_transactions_purchase_order');
    expect(compatibility).toContain('idx_quota_orders_provider_trade');
    expect(compatibility).toContain("('registration_enabled', 'false'::jsonb");
    expect(compatibility).toContain("VALUES ('003_public_api_compatibility'");
  });

  it('adds API-key daily aggregates without changing the immutable foundation', () => {
    const migration = fs.readFileSync(path.join(migrationsDirectory, '004_api_key_daily_usage.sql'), 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS user_api_key_daily_usage');
    expect(migration).toContain('PRIMARY KEY (usage_date, user_id, api_key_id, model_code)');
    expect(migration).toContain("VALUES ('004_api_key_daily_usage'");
  });
});
