-- Reference data moved out of UI code into the database.
-- Covers: currency types, remittance corridors, payout partners,
-- FX rate overrides, and KYC option lists (occupation / income / relationship).

-- ── Currency types ───────────────────────────────────────────────────────────
-- Was a CHECK constraint + hardcoded TYPE_COLORS map in admin/Currencies.tsx.
CREATE TABLE IF NOT EXISTS currency_types (
  type_code   VARCHAR(12)  PRIMARY KEY,
  label       VARCHAR(40)  NOT NULL,
  badge_class VARCHAR(60)  NOT NULL DEFAULT 'bg-gray-100 text-gray-600',
  sort_order  SMALLINT     NOT NULL DEFAULT 0
);

INSERT INTO currency_types (type_code, label, badge_class, sort_order) VALUES
  ('FIAT',       'Fiat',       'bg-blue-100 text-blue-800',     1),
  ('STABLECOIN', 'Stablecoin', 'bg-purple-100 text-purple-800', 2),
  ('TREASURY',   'Treasury',   'bg-amber-100 text-amber-800',   3)
ON CONFLICT (type_code) DO NOTHING;

-- Replace the hardcoded CHECK with a FK to the lookup table.
ALTER TABLE currencies DROP CONSTRAINT IF EXISTS currencies_currency_type_check;
DO $$ BEGIN
  ALTER TABLE currencies
    ADD CONSTRAINT currencies_currency_type_fk
    FOREIGN KEY (currency_type) REFERENCES currency_types(type_code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Remittance corridors ─────────────────────────────────────────────────────
-- Was hardcoded country buttons in consumer/Send.tsx (Zimbabwe enabled,
-- South Africa disabled, "UK, USA — Coming Soon").
CREATE TABLE IF NOT EXISTS corridors (
  corridor_id         SERIAL       PRIMARY KEY,
  send_country_code   VARCHAR(3)   NOT NULL REFERENCES countries(country_code),
  receive_country_code VARCHAR(3)  NOT NULL REFERENCES countries(country_code),
  status              VARCHAR(12)  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','disabled','coming_soon')),
  sort_order          SMALLINT     NOT NULL DEFAULT 0,
  UNIQUE (send_country_code, receive_country_code)
);

INSERT INTO corridors (send_country_code, receive_country_code, status, sort_order) VALUES
  ('ZA', 'ZW', 'active',      1),
  ('ZA', 'US', 'coming_soon', 2)
ON CONFLICT (send_country_code, receive_country_code) DO NOTHING;

-- ── Payout partners (per corridor + method) ──────────────────────────────────
-- Was ZW_BANKS array and EcoCash/O'Mari operator list in consumer/Send.tsx.
CREATE TABLE IF NOT EXISTS payout_partners (
  partner_id           SERIAL       PRIMARY KEY,
  receive_country_code VARCHAR(3)   NOT NULL REFERENCES countries(country_code),
  method               VARCHAR(20)  NOT NULL
                       CHECK (method IN ('bank','mobile_money','cash')),
  name                 VARCHAR(80)  NOT NULL,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order           SMALLINT     NOT NULL DEFAULT 0,
  UNIQUE (receive_country_code, method, name)
);

INSERT INTO payout_partners (receive_country_code, method, name, sort_order) VALUES
  ('ZW', 'bank', 'CBZ Bank',         1),
  ('ZW', 'bank', 'Stanbic Zimbabwe', 2),
  ('ZW', 'bank', 'FBC Bank',         3),
  ('ZW', 'bank', 'ZB Bank',          4),
  ('ZW', 'bank', 'NMB Bank',         5),
  ('ZW', 'bank', 'Steward Bank',     6),
  ('ZW', 'bank', 'BancABC',          7),
  ('ZW', 'bank', 'CABS',             8),
  ('ZW', 'mobile_money', 'EcoCash',  1),
  ('ZW', 'mobile_money', 'O''Mari',  2)
ON CONFLICT (receive_country_code, method, name) DO NOTHING;

-- ── FX rate overrides ────────────────────────────────────────────────────────
-- Admin-set rate that overrides the live feed for a given pair (when present).
-- Seeded with the previous hardcoded 18.5 ZAR→ZIG placeholder so behaviour is
-- preserved until a live provider key is configured or the override is cleared.
CREATE TABLE IF NOT EXISTS fx_rate_overrides (
  from_currency VARCHAR(10)   NOT NULL REFERENCES currencies(currency_code),
  to_currency   VARCHAR(10)   NOT NULL REFERENCES currencies(currency_code),
  rate          NUMERIC(20,8) NOT NULL,
  note          VARCHAR(200),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_currency, to_currency)
);

INSERT INTO fx_rate_overrides (from_currency, to_currency, rate, note) VALUES
  ('ZAR', 'ZIG', 18.5, 'Seeded placeholder — clear to use live feed once provider key is set')
ON CONFLICT (from_currency, to_currency) DO NOTHING;

-- ── KYC option lists ─────────────────────────────────────────────────────────
-- Was OCCUPATIONS / INCOME_SOURCES / RELATIONSHIPS arrays in the UI.
CREATE TABLE IF NOT EXISTS kyc_options (
  option_id   SERIAL       PRIMARY KEY,
  category    VARCHAR(20)  NOT NULL
              CHECK (category IN ('occupation','income_source','relationship')),
  label       VARCHAR(80)  NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  UNIQUE (category, label)
);

INSERT INTO kyc_options (category, label, sort_order) VALUES
  ('occupation', 'Employed (Formal)',        1),
  ('occupation', 'Self-Employed',            2),
  ('occupation', 'Informal Business',        3),
  ('occupation', 'Unemployed',               4),
  ('occupation', 'Student',                  5),
  ('occupation', 'Retired',                  6),
  ('occupation', 'Pensioner',                7),
  ('occupation', 'Government Employee',       8),
  ('occupation', 'Domestic Worker',          9),
  ('occupation', 'Agriculture / Farming',    10),
  ('occupation', 'Casual / Piece Work',      11),
  ('occupation', 'Other',                    12),
  ('income_source', 'Salary',                1),
  ('income_source', 'Wages',                 2),
  ('income_source', 'Business Income',       3),
  ('income_source', 'Savings',               4),
  ('income_source', 'Family Support',        5),
  ('income_source', 'Gift Received',         6),
  ('income_source', 'Pension',               7),
  ('income_source', 'Grant',                 8),
  ('income_source', 'Sale of Goods or Assets', 9),
  ('income_source', 'Investment Income',     10),
  ('income_source', 'Loan Proceeds',         11),
  ('income_source', 'Other',                 12),
  ('relationship', 'Immediate Family (spouse, parent, child)',      1),
  ('relationship', 'Extended Family (sibling, cousin, uncle/aunt)', 2),
  ('relationship', 'Friend',          3),
  ('relationship', 'Employee',        4),
  ('relationship', 'Employer',        5),
  ('relationship', 'Business Partner', 6),
  ('relationship', 'Self',            7),
  ('relationship', 'Other',           8)
ON CONFLICT (category, label) DO NOTHING;
