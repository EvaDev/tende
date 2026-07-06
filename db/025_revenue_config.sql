-- Revenue fee rates (editable in Admin → Settings → Revenue).
INSERT INTO app_config (key, value, description) VALUES
  ('revenue.fx_spread_bps',       '150', 'FX conversion spread in basis points (150 = 1.5%). Applied to ZAR ↔ USD treasury-token conversions.'),
  ('revenue.settlement_fee_bps',  '0',   'Platform fee on merchant fiat settlement in basis points. Deducted from the bank payout; retained when tokens move to platform treasury.')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE settlement_requests
  ADD COLUMN IF NOT EXISTS fee_bps    INTEGER,
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(18,2);
