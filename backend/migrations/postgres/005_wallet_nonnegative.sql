BEGIN;

DO $wallet_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wallets_quota_balance_check' AND conrelid='wallets'::regclass) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_quota_balance_check CHECK (quota_balance >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wallets_gift_quota_check' AND conrelid='wallets'::regclass) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_gift_quota_check CHECK (gift_quota >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wallets_frozen_balance_check' AND conrelid='wallets'::regclass) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_frozen_balance_check CHECK (frozen_balance >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wallets_total_spent_check' AND conrelid='wallets'::regclass) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_total_spent_check CHECK (total_spent >= 0) NOT VALID;
  END IF;
END;
$wallet_constraints$;

ALTER TABLE wallets VALIDATE CONSTRAINT wallets_quota_balance_check;
ALTER TABLE wallets VALIDATE CONSTRAINT wallets_gift_quota_check;
ALTER TABLE wallets VALIDATE CONSTRAINT wallets_frozen_balance_check;
ALTER TABLE wallets VALIDATE CONSTRAINT wallets_total_spent_check;

INSERT INTO schema_migrations (version, checksum)
VALUES ('005_wallet_nonnegative', 'wallet-nonnegative-v1')
ON CONFLICT (version) DO NOTHING;

COMMIT;
