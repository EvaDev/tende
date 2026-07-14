-- External wallet USDC withdrawals: platform fee + spend ledger for KYC limits.

INSERT INTO app_config (key, value, description) VALUES
  ('revenue.withdrawal_fee_bps', '150',
   'Platform fee on consumer USDC withdrawals to external wallets (MetaMask etc.) in basis points. Deducted from the send amount; net ERC-20 goes out, fee retained as platform USDC claim.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS consumer_spend_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_id      VARCHAR(36) NOT NULL REFERENCES consumers(consumer_id),
    wallet_address   TEXT NOT NULL,
    spend_type       TEXT NOT NULL
                     CHECK (spend_type IN ('p2p', 'purchase', 'withdrawal', 'escrow', 'remittance')),
    currency         TEXT NOT NULL,
    amount_units     NUMERIC(36, 0) NOT NULL,
    amount_limit_units NUMERIC(36, 0) NOT NULL,
    counterparty     TEXT,
    tx_hash          TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consumer_spend_events_wallet_day_idx
    ON consumer_spend_events (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS consumer_spend_events_consumer_type_idx
    ON consumer_spend_events (consumer_id, spend_type, created_at DESC);

COMMENT ON COLUMN consumer_spend_events.amount_limit_units IS
  'Amount normalized to 2-decimal ZAR-equivalent minor units for KYC tier comparisons '
  '(USDC converted via FX). max_single_tx / max_daily_send / max_monthly_spend use the same units.';

CREATE TABLE IF NOT EXISTS consumer_withdrawals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consumer_id      VARCHAR(36) NOT NULL REFERENCES consumers(consumer_id),
    from_wallet      TEXT NOT NULL,
    to_address       TEXT NOT NULL,
    gross_units      NUMERIC(36, 0) NOT NULL,
    fee_units        NUMERIC(36, 0) NOT NULL,
    net_units        NUMERIC(36, 0) NOT NULL,
    fee_bps          INTEGER NOT NULL,
    currency         TEXT NOT NULL DEFAULT 'USDC',
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'executed', 'failed')),
    withdraw_tx      TEXT,
    fee_debit_tx     TEXT,
    fee_credit_tx    TEXT,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS consumer_withdrawals_wallet_idx
    ON consumer_withdrawals (from_wallet, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON consumer_spend_events TO imali_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON consumer_withdrawals TO imali_app;
