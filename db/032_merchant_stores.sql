-- Merchant stores: country + fiat per physical location (multi-country retail).

CREATE TABLE IF NOT EXISTS merchant_stores (
  store_id       VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
  merchant_id    VARCHAR(36)  NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  store_code     VARCHAR(40)  NOT NULL,
  name           VARCHAR(120) NOT NULL,
  country_code   VARCHAR(3)   NOT NULL REFERENCES countries(country_code),
  currency_code  VARCHAR(10)  NOT NULL REFERENCES currencies(currency_code),
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, store_code)
);

CREATE INDEX IF NOT EXISTS merchant_stores_merchant_idx ON merchant_stores (merchant_id, is_active);

ALTER TABLE change_vouchers
  ADD COLUMN IF NOT EXISTS store_id VARCHAR(36) REFERENCES merchant_stores(store_id);

ALTER TABLE merchant_sales
  ADD COLUMN IF NOT EXISTS store_id VARCHAR(36) REFERENCES merchant_stores(store_id);
