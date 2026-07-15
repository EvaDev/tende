-- Product catalogue API sync + purchase fulfilment escrow.
-- Merchants can maintain products manually and/or sync from an external catalog
-- (first adapter: Flash PIM). Purchases hold funds at the platform escrow until
-- the product fulfilment API succeeds (release to merchant) or fails (refund).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode          VARCHAR(64),
  ADD COLUMN IF NOT EXISTS fulfilment_url   TEXT,
  ADD COLUMN IF NOT EXISTS source           VARCHAR(20) NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  ALTER TABLE products
    ADD CONSTRAINT products_source_check CHECK (source IN ('manual', 'api'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products (merchant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_external_merchant
  ON products (merchant_id, external_product_id) WHERE external_product_id IS NOT NULL;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS catalog_api_url       TEXT,
  ADD COLUMN IF NOT EXISTS catalog_api_adapter   VARCHAR(40),
  ADD COLUMN IF NOT EXISTS catalog_synced_at     TIMESTAMPTZ;

COMMENT ON COLUMN merchants.catalog_api_url IS
  'Full URL of the external product listing endpoint (e.g. Flash PIM /api/PimProducts/{channelId}).';
COMMENT ON COLUMN merchants.catalog_api_adapter IS
  'Parser for the catalog response: flash_pim (more adapters later).';

ALTER TABLE merchant_sales
  ADD COLUMN IF NOT EXISTS escrow_tx            VARCHAR(66),
  ADD COLUMN IF NOT EXISTS release_tx           VARCHAR(66),
  ADD COLUMN IF NOT EXISTS fulfilment_url       TEXT,
  ADD COLUMN IF NOT EXISTS fulfilment_status    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS fulfilment_error     TEXT;

-- status values in use: paid (legacy / fulfilled), pending_fulfilment, refunded
COMMENT ON COLUMN merchant_sales.fulfilment_status IS
  'pending | success | failed — tracks the fulfilment API call for escrow purchases.';
COMMENT ON COLUMN products.barcode IS
  'POS / supplier barcode (e.g. Flash Internal Barcode).';
COMMENT ON COLUMN products.fulfilment_url IS
  'HTTP endpoint called after payment to complete the purchase; funds stay in escrow until success.';
COMMENT ON COLUMN products.source IS
  'manual = merchant-created; api = synced from catalog_api_url (upserted by external_product_id).';

-- Existing rows get the mock fulfilment endpoint once PUBLIC_API_BASE is known;
-- app create/sync paths also set this. Leave NULL here so runtime default applies.
