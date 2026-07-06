-- Change vouchers: merchant-issued store credit (digital change) credited to a consumer wallet.
-- Value moves merchant Vault claim → consumer Vault claim via backend adminDebit/adminCredit.

CREATE TABLE IF NOT EXISTS change_vouchers (
  voucher_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         VARCHAR(36)  NOT NULL REFERENCES merchants(merchant_id),
  product_id          VARCHAR(36)  REFERENCES products(product_id),
  amount              NUMERIC(20,8) NOT NULL,
  currency            VARCHAR(10)  NOT NULL DEFAULT 'ZAR',
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','claimed','expired','cancelled')),
  delivery_mode       VARCHAR(20)  NOT NULL
                      CHECK (delivery_mode IN ('qr','tag','link')),
  recipient_wallet    VARCHAR(42),
  recipient_tag       VARCHAR(64),
  claim_secret_hash   VARCHAR(66)  NOT NULL,
  store_number        VARCHAR(40),
  till_number         VARCHAR(40),
  issued_by_member_id INTEGER      REFERENCES merchant_members(id),
  debit_tx            VARCHAR(66),
  credit_tx           VARCHAR(66),
  expires_at          TIMESTAMPTZ  NOT NULL,
  claimed_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS change_vouchers_secret_hash_idx ON change_vouchers (claim_secret_hash);
CREATE INDEX IF NOT EXISTS change_vouchers_merchant_idx ON change_vouchers (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_vouchers_recipient_idx ON change_vouchers (recipient_wallet, created_at DESC);
