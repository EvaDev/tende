-- Widen sale status for escrow fulfilment lifecycle, and store product brand.
ALTER TABLE merchant_sales
  ALTER COLUMN status TYPE VARCHAR(32);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS brand VARCHAR(100);

COMMENT ON COLUMN products.brand IS
  'Supplier / marketing brand (e.g. Flash PIM baseProduct.brand = 1Voucher).';
COMMENT ON COLUMN products.category IS
  'Product category (e.g. Flash PIM productCategory = eVoucher, Airtime).';
