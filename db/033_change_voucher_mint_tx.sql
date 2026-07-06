-- Treasury mint tx when merchant float is topped up to issue change (Mint & Burn audit link).

ALTER TABLE change_vouchers
  ADD COLUMN IF NOT EXISTS mint_tx VARCHAR(66);

CREATE INDEX IF NOT EXISTS change_vouchers_mint_tx_idx ON change_vouchers (mint_tx)
  WHERE mint_tx IS NOT NULL;
