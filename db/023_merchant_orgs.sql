-- Merchant multi-user org model (hybrid custody, option (c)):
-- receiving stays on the existing merchant wallet (trustedCounterparty / TT
-- whitelist, unchanged, no signature needed to receive). Day-to-day operator
-- access moves off wallet-connect onto passkey/email logins scoped to the
-- merchant org. Outbound settlement already runs through Vault.withdrawToExternal
-- (ADMIN_EXECUTOR_ROLE, backend-signed — no merchant private key involved on
-- chain today), so the "head-office approval" gate is an off-chain business
-- rule enforced here before the backend is allowed to call it, not a new
-- on-chain signer.

CREATE TABLE IF NOT EXISTS merchant_members (
  id            SERIAL PRIMARY KEY,
  merchant_id   VARCHAR(36) NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  email         CITEXT,
  display_name  VARCHAR(120),
  role          VARCHAR(20) NOT NULL CHECK (role IN ('org_admin','store_manager','cashier')),
  status        VARCHAR(20) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  store_scope   VARCHAR(60),  -- optional: restrict a cashier to one store# (matches POS store# text, not a FK)
  invited_by    INTEGER REFERENCES merchant_members(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, email)
);

-- Passkey credentials for operator login (mirrors consumer webauthn_credentials,
-- but keyed to a merchant_members row instead of a wallet).
CREATE TABLE IF NOT EXISTS merchant_member_credentials (
  id             SERIAL PRIMARY KEY,
  member_id      INTEGER NOT NULL REFERENCES merchant_members(id) ON DELETE CASCADE,
  credential_id  TEXT NOT NULL UNIQUE,
  public_key_x   TEXT NOT NULL,
  public_key_y   TEXT NOT NULL,
  counter        BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-merchant settlement threshold: payouts at/below stay auto-approved,
-- above requires a second org_admin (head office) to approve.
CREATE TABLE IF NOT EXISTS merchant_settlement_config (
  merchant_id       VARCHAR(36) PRIMARY KEY REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  threshold_amount  NUMERIC(18,2) NOT NULL DEFAULT 0,
  threshold_currency VARCHAR(10),
  require_approval  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS settlement_requests (
  id                SERIAL PRIMARY KEY,
  merchant_id       VARCHAR(36) NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  requested_by      INTEGER NOT NULL REFERENCES merchant_members(id),
  amount            NUMERIC(18,2) NOT NULL,
  currency          VARCHAR(10) NOT NULL,
  destination       VARCHAR(300) NOT NULL, -- bank ref or external address, off-ramp dependent
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','executed','failed')),
  approved_by       INTEGER REFERENCES merchant_members(id),
  approved_at       TIMESTAMPTZ,
  executed_tx_hash  VARCHAR(80),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grandfather the existing single merchant's owner as org_admin (head office).
-- No wallet migration: merchants.wallet_address keeps receiving as-is. This
-- merchant has no email/contact_person on file yet, so the row is seeded
-- 'invited' with no email — head office completes setup (sets email,
-- registers a passkey) via the merchant-app first-login/claim flow.
INSERT INTO merchant_members (merchant_id, display_name, role, status)
SELECT merchant_id, name, 'org_admin', 'invited'
FROM merchants
WHERE lower(wallet_address) = lower('0x358AfB69999C4Ac8F621027B2a841AC849FcaA71')
  AND NOT EXISTS (
    SELECT 1 FROM merchant_members mm WHERE mm.merchant_id = merchants.merchant_id
  );
