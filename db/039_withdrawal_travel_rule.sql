-- Travel Rule beneficiary details on external USDC withdrawals.
-- Originator identity comes from the KYC'd consumer; beneficiary is declared by the sender.

ALTER TABLE consumer_withdrawals
  ADD COLUMN IF NOT EXISTS recipient_name         TEXT,
  ADD COLUMN IF NOT EXISTS recipient_id_number    TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone        TEXT,
  ADD COLUMN IF NOT EXISTS recipient_country      TEXT,
  ADD COLUMN IF NOT EXISTS recipient_relationship TEXT;

COMMENT ON COLUMN consumer_withdrawals.recipient_name IS
  'Travel Rule beneficiary legal name as declared by the sender.';
COMMENT ON COLUMN consumer_withdrawals.recipient_id_number IS
  'Optional Travel Rule beneficiary national ID / passport number.';
COMMENT ON COLUMN consumer_withdrawals.recipient_phone IS
  'Optional Travel Rule beneficiary contact phone.';
COMMENT ON COLUMN consumer_withdrawals.recipient_country IS
  'Optional ISO country code of the beneficiary.';
COMMENT ON COLUMN consumer_withdrawals.recipient_relationship IS
  'Optional relationship of sender to beneficiary (family, friend, self, business, other).';
