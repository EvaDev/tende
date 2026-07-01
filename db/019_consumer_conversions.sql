-- Records each consumer FX conversion (e.g. ZAR → USD) with the rate and the
-- platform fee (the spread). Drives the consumer's transaction-history detail and
-- the admin's conversion-fee revenue view. The fee is the spread retained by the
-- platform (consumer is debited the full `from` amount and credited the post-spread
-- `to` amount) — recorded here so it's reportable.
CREATE TABLE IF NOT EXISTS consumer_conversions (
    id            BIGSERIAL     PRIMARY KEY,
    wallet        VARCHAR(42)   NOT NULL,
    from_currency VARCHAR(12)   NOT NULL,
    to_currency   VARCHAR(12)   NOT NULL,
    from_amount   NUMERIC(78,0) NOT NULL,   -- raw units of from_currency (ZAR = 2dp)
    to_amount     NUMERIC(78,0) NOT NULL,   -- raw units of to_currency (USDC = 6dp)
    rate          NUMERIC       NOT NULL,   -- mid-market rate used (to per from)
    spread_bps    INTEGER       NOT NULL,   -- platform spread in basis points
    fee_amount    NUMERIC(78,0) NOT NULL,   -- fee in from_currency raw units
    fee_currency  VARCHAR(12)   NOT NULL,
    debit_tx      VARCHAR(66),              -- from-leg burn tx
    credit_tx     VARCHAR(66),              -- to-leg mint tx
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversions_wallet    ON consumer_conversions(LOWER(wallet));
CREATE INDEX IF NOT EXISTS idx_conversions_credit_tx ON consumer_conversions(credit_tx);
CREATE INDEX IF NOT EXISTS idx_conversions_debit_tx  ON consumer_conversions(debit_tx);
