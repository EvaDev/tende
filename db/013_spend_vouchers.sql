-- Phase-1 cross-border spend vouchers + merchant accepted-currency allow-list.
-- See memory project_value_model for the design. Key principle: these tables are
-- the OFF-CHAIN record/orchestration layer only — the value itself moves on-chain
-- (Vault ledger / TreasuryToken). Tx hashes correlate rows to chain events; the
-- indexer (separate workstream) projects on-chain events for reporting.
--
-- NB: references the merchants table (owned by the schema owner). If the app role
-- lacks CREATE/REFERENCES, run this migration as the schema owner (as with 012).

-- Which currencies a merchant ACCEPTS for payment (e.g. a Blantyre store accepting
-- ZAR vouchers), decoupled from its settlement/payout currency.
CREATE TABLE IF NOT EXISTS merchant_accepted_currencies (
    merchant_id    VARCHAR(36) NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
    currency_code  VARCHAR(10) NOT NULL REFERENCES currencies(currency_code),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (merchant_id, currency_code)
);

-- Voucher lifecycle. Recipient may not be onboarded at issue time, so recipient_*
-- are nullable with NO FK to consumers (filled at claim).
CREATE TABLE IF NOT EXISTS spend_vouchers (
    voucher_id         VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    status             VARCHAR(16)  NOT NULL DEFAULT 'ISSUED'
                         CHECK (status IN ('ISSUED','PENDING_CLAIM','CLAIMED','REDEEMED','SETTLED','EXPIRED','CANCELLED')),
    currency_code      VARCHAR(10)  NOT NULL REFERENCES currencies(currency_code),  -- voucher denomination, e.g. 'ZAR'
    amount             BIGINT       NOT NULL CHECK (amount > 0),                     -- minor units (2-dec cents)

    issuer_wallet      VARCHAR(42)  NOT NULL,                                        -- funding consumer (known at creation)

    recipient_contact  VARCHAR(120),                                                -- phone/WhatsApp (minimal PII)
    recipient_wallet   VARCHAR(42),                                                 -- set at claim
    claim_token_hash   VARCHAR(66),                                                 -- hash of the claim-link secret (never plaintext)
    expires_at         TIMESTAMPTZ,

    -- on-chain correlation (backend records tx hashes at submission)
    funding_tx         VARCHAR(66),    -- on-ramp / issue
    escrow_tx          VARCHAR(66),    -- issuer -> platform escrow (send; domestic)
    claim_tx           VARCHAR(66),    -- escrow -> recipient (cross-border, to KYC'd beneficiary)
    claimed_at         TIMESTAMPTZ,

    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spend_vouchers_status    ON spend_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_spend_vouchers_issuer    ON spend_vouchers(issuer_wallet);
CREATE INDEX IF NOT EXISTS idx_spend_vouchers_recipient ON spend_vouchers(recipient_wallet);

-- A redemption at a merchant. Captures the FX spot used (ZAR<->local) for receipts
-- and audit. Supports partial spend (multiple redemptions per voucher).
CREATE TABLE IF NOT EXISTS voucher_redemptions (
    redemption_id    VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    voucher_id       VARCHAR(36)   NOT NULL REFERENCES spend_vouchers(voucher_id) ON DELETE CASCADE,
    merchant_id      VARCHAR(36)   NOT NULL REFERENCES merchants(merchant_id),
    local_currency   VARCHAR(10)   NOT NULL REFERENCES currencies(currency_code),  -- store currency, e.g. 'MWK'
    local_amount     BIGINT        NOT NULL,                                        -- store price, minor units
    fx_rate          NUMERIC(20,8) NOT NULL,                                        -- local units per 1 voucher-ccy unit
    fx_source        VARCHAR(40),
    fx_captured_at   TIMESTAMPTZ   NOT NULL,
    amount           BIGINT        NOT NULL,                                        -- voucher-ccy (ZAR) minor units moved
    redeem_tx        VARCHAR(66),                                                   -- recipient -> merchant on-chain
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_voucher  ON voucher_redemptions(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_merchant ON voucher_redemptions(merchant_id);

-- Fiat settlement of a merchant's accrued balance (e.g. Flash pays ZAR to the store;
-- TreasuryToken burned on off-ramp).
CREATE TABLE IF NOT EXISTS voucher_settlements (
    settlement_id    VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    voucher_id       VARCHAR(36)  REFERENCES spend_vouchers(voucher_id) ON DELETE SET NULL,
    merchant_id      VARCHAR(36)  NOT NULL REFERENCES merchants(merchant_id),
    settled_currency VARCHAR(10)  NOT NULL REFERENCES currencies(currency_code),   -- 'ZAR'
    settled_amount   BIGINT       NOT NULL,
    flash_reference  VARCHAR(120),                                                 -- fiat partner reference
    burn_tx          VARCHAR(66),                                                  -- TreasuryToken burn (off-ramp)
    status           VARCHAR(16)  NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','SETTLED','FAILED')),
    settled_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_settlements_merchant ON voucher_settlements(merchant_id);

-- Append-only audit/compliance trail for every voucher state change (Travel-Rule /
-- FICA record). Each row links a business event to its on-chain tx where applicable.
CREATE TABLE IF NOT EXISTS voucher_events (
    event_id     BIGSERIAL    PRIMARY KEY,
    voucher_id   VARCHAR(36)  NOT NULL REFERENCES spend_vouchers(voucher_id) ON DELETE CASCADE,
    event_type   VARCHAR(40)  NOT NULL,   -- ISSUED|ESCROWED|CLAIMED|REDEEMED|SETTLED|EXPIRED|...
    actor        VARCHAR(42),             -- wallet/operator that caused it
    on_chain_tx  VARCHAR(66),
    payload      JSONB,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_events_voucher ON voucher_events(voucher_id);
