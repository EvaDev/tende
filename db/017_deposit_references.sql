-- Off-chain metadata linking an on-chain mint+credit (a "cash-in") to the physical
-- event that backs it: a bank-deposit reference (admin) or a voucher number
-- (consumer). The on-chain value is the Vault credit + TTZA mint; this row is the
-- audit link to the real-world deposit. `reference` is unique so a voucher/deposit
-- can't be redeemed twice. (POC: on Sepolia any unique voucher simulates a deposit.)
CREATE TABLE IF NOT EXISTS deposit_references (
    id          BIGSERIAL     PRIMARY KEY,
    reference   VARCHAR(80)   NOT NULL UNIQUE,            -- voucher number | bank-deposit ref
    kind        VARCHAR(16)   NOT NULL,                   -- 'voucher' | 'bank_deposit'
    source      VARCHAR(16)   NOT NULL,                   -- 'consumer' | 'admin'
    wallet      VARCHAR(42)   NOT NULL,                   -- credited wallet
    amount      NUMERIC(78,0) NOT NULL,                   -- raw units (ZAR = 2dp)
    currency    VARCHAR(12)   NOT NULL DEFAULT 'ZAR',
    mint_tx     VARCHAR(66),                              -- TTZA mint (backing)
    credit_tx   VARCHAR(66),                              -- Vault credit (claim)
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deposit_references_wallet  ON deposit_references(wallet);
CREATE INDEX IF NOT EXISTS idx_deposit_references_mint_tx ON deposit_references(mint_tx);
