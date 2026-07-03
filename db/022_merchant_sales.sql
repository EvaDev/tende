-- Completed merchant sales (POS purchases). One row per consumer→merchant payment
-- made through the Buy flow, written by the transfer/submit handler after the
-- on-chain Vault.transfer relays. This is the merchant's sales ledger: it links the
-- payment to the store/till it was rung up on, the device GPS at charge time, and
-- the line items, none of which live on-chain. `tx_hash` ties each row back to the
-- indexed chain_events transfer.
CREATE TABLE IF NOT EXISTS merchant_sales (
    sale_id         BIGSERIAL     PRIMARY KEY,
    merchant_id     VARCHAR(36)   REFERENCES merchants(merchant_id),
    merchant_wallet VARCHAR(66)   NOT NULL,   -- recipient (POS QR `to`)
    consumer_wallet VARCHAR(66),              -- payer
    consumer_tag    VARCHAR(100),             -- payer @ens at time of sale
    amount          NUMERIC(20,2) NOT NULL,   -- total, in major units of `currency`
    currency        VARCHAR(12)   NOT NULL,
    store_number    VARCHAR(40),              -- merchant-entered on the POS
    till_number     VARCHAR(40),
    latitude        NUMERIC(9,6),             -- POS device GPS at charge time
    longitude       NUMERIC(9,6),
    items           JSONB,                    -- [{ name, qty, unitPrice, lineTotal }]
    tx_hash         VARCHAR(66),              -- the Vault.transfer relay tx
    status          VARCHAR(12)   NOT NULL DEFAULT 'paid',
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_merchant_sales_merchant ON merchant_sales(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_merchant_sales_tx       ON merchant_sales(tx_hash);
CREATE INDEX IF NOT EXISTS idx_merchant_sales_consumer ON merchant_sales(LOWER(consumer_wallet));
