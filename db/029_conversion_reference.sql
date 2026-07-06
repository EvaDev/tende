-- Off-chain reference for each FX conversion (audit / mint & burn report linkage).
ALTER TABLE consumer_conversions
  ADD COLUMN IF NOT EXISTS reference VARCHAR(40),
  ADD COLUMN IF NOT EXISTS mint_tx   VARCHAR(66);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversions_reference ON consumer_conversions(reference)
  WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversions_mint_tx ON consumer_conversions(mint_tx)
  WHERE mint_tx IS NOT NULL;
