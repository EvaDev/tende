-- WhatsApp escrow claims (Phase 1). Value sent to a not-yet-onboarded recipient is
-- held on-chain at the custodial escrow address (a Vault unified balance). This
-- table holds ONLY the off-chain facts needed to release it: the claim secret hash
-- (the plaintext lives only in the wa.me link), the beneficiary phone (Travel-Rule),
-- amount/currency, lifecycle status and a 7-day expiry. The chain is the source of
-- truth for value; this is the claim projection (see project_value_model).
CREATE TABLE IF NOT EXISTS pending_claims (
    id              BIGSERIAL     PRIMARY KEY,
    secret_hash     VARCHAR(66)   NOT NULL UNIQUE,            -- '0x'+sha256(secret)
    sender_wallet   VARCHAR(42)   NOT NULL,
    recipient_phone VARCHAR(32)   NOT NULL,                   -- beneficiary contact
    amount          NUMERIC(78,0) NOT NULL,                   -- raw token units (ZAR = 2dp)
    currency        VARCHAR(12)   NOT NULL DEFAULT 'ZAR',
    status          VARCHAR(16)   NOT NULL DEFAULT 'pending', -- pending|claimed|reclaimed
    escrow_tx       VARCHAR(66),                              -- sender -> escrow transfer
    release_tx      VARCHAR(66),                              -- escrow -> recipient / sender
    claimed_by      VARCHAR(42),                              -- recipient wallet on claim
    expires_at      TIMESTAMPTZ   NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_claims_status ON pending_claims(status);
CREATE INDEX IF NOT EXISTS idx_pending_claims_sender ON pending_claims(sender_wallet);
