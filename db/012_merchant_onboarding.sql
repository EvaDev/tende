-- Self-service merchant onboarding fields. KYB is collected but NOT verified yet
-- (verification_status stays 'PENDING'). settlement_type captures whether the
-- merchant is paid out in fiat or on-chain.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS address         VARCHAR(300),
  ADD COLUMN IF NOT EXISTS contact_person  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS settlement_type VARCHAR(10)
    CHECK (settlement_type IN ('FIAT','ONCHAIN'));
