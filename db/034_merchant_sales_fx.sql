-- Cross-border POS: store rings up in local currency (e.g. MWK), consumer pays in
-- settlement currency (e.g. ZAR) via direct TTZA transfer at the quoted FX rate.

ALTER TABLE merchant_sales
  ADD COLUMN IF NOT EXISTS charge_amount   NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS charge_currency VARCHAR(12),
  ADD COLUMN IF NOT EXISTS fx_rate         NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS fx_source       VARCHAR(40);

INSERT INTO fx_rate_overrides (from_currency, to_currency, rate, note) VALUES
  ('ZAR', 'MWK', 94.50000000, 'POC placeholder for MW cross-border POS — clear to use live feed')
ON CONFLICT (from_currency, to_currency) DO NOTHING;
