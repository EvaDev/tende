-- =============================================================================
-- Migration 042: Seed KYC tiers for every country that only had ZA seeded.
-- Without these rows, Admin "Set KYC Level" updates on-chain but consumers.kyc_level_id
-- stays NULL (no matching kyc_levels row), so Account shows "—".
-- =============================================================================

INSERT INTO kyc_levels
    (country_code, level_name, max_single_tx, max_daily_spend, max_monthly_spend,
     max_wallet_balance, max_daily_send, requires_id_doc, requires_biometric,
     allows_usd_savings, allows_remittance, idos_credential_required,
     requires_full_name, requires_mobile)
SELECT
    c.country_code,
    t.level_name,
    t.max_single_tx,
    t.max_daily_spend,
    t.max_monthly_spend,
    t.max_wallet_balance,
    t.max_daily_send,
    t.requires_id_doc,
    t.requires_biometric,
    t.allows_usd_savings,
    t.allows_remittance,
    t.idos_credential_required,
    TRUE,
    TRUE
FROM countries c
CROSS JOIN (VALUES
    ('Level 0 (Unverified)',
     500000::numeric, 1000000::numeric, 5000000::numeric, 5000000::numeric, 500000::numeric,
     FALSE, FALSE, FALSE, FALSE, FALSE),
    ('Level 1 (Basic ID)',
     2500000::numeric, 10000000::numeric, 25000000::numeric, 25000000::numeric, 5000000::numeric,
     TRUE, FALSE, FALSE, FALSE, TRUE),
    ('Level 2 (Full KYC)',
     10000000::numeric, 50000000::numeric, 200000000::numeric, 100000000::numeric, 25000000::numeric,
     TRUE, TRUE, TRUE, TRUE, TRUE),
    ('Level 3 (Enhanced)',
     50000000::numeric, 200000000::numeric, 500000000::numeric, 500000000::numeric, 100000000::numeric,
     TRUE, TRUE, TRUE, TRUE, TRUE)
) AS t(level_name, max_single_tx, max_daily_spend, max_monthly_spend, max_wallet_balance, max_daily_send,
       requires_id_doc, requires_biometric, allows_usd_savings, allows_remittance, idos_credential_required)
WHERE NOT EXISTS (
    SELECT 1 FROM kyc_levels k WHERE k.country_code = c.country_code
)
ON CONFLICT (country_code, level_name) DO NOTHING;

-- Also add Level 3 for countries that already had 0–2 (e.g. ZA) so admin 0–3 maps cleanly.
INSERT INTO kyc_levels
    (country_code, level_name, max_single_tx, max_daily_spend, max_monthly_spend,
     max_wallet_balance, max_daily_send, requires_id_doc, requires_biometric,
     allows_usd_savings, allows_remittance, idos_credential_required,
     requires_full_name, requires_mobile)
SELECT
    c.country_code,
    'Level 3 (Enhanced)',
    50000000, 200000000, 500000000, 500000000, 100000000,
    TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
FROM countries c
WHERE EXISTS (SELECT 1 FROM kyc_levels k WHERE k.country_code = c.country_code)
  AND NOT EXISTS (
    SELECT 1 FROM kyc_levels k
     WHERE k.country_code = c.country_code AND k.level_name LIKE 'Level 3%'
  )
ON CONFLICT (country_code, level_name) DO NOTHING;
