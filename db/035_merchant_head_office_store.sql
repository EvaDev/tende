-- Head office store: merchant home country/currency for POS and ZA product corridors.

INSERT INTO merchant_stores (merchant_id, store_code, name, country_code, currency_code)
SELECT m.merchant_id, 'HO', 'Head office', m.country_code, m.currency_code
FROM merchants m
WHERE NOT EXISTS (
  SELECT 1 FROM merchant_stores s
  WHERE s.merchant_id = m.merchant_id AND s.store_code = 'HO'
);
