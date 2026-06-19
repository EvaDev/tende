-- =============================================================================
-- iMali System Database  —  Migration 001: Initial Schema
-- =============================================================================
-- Single PostgreSQL database, three logical domains:
--   system_config  : countries, currencies, stablecoins, kyc_levels
--   merchant       : merchants, offramp config, products, SKUs
--   consumer       : consumers, merchant links
--   events         : on-chain event index (read / reporting)
--
-- Conventions
--   • All PKs are varchar UUIDs (gen_random_uuid()) except numeric sequences
--   • Monetary amounts stored as NUMERIC(20,8) — supports both fiat cents and
--     token micro-units; the application layer handles display rounding
--   • Timestamps are TIMESTAMPTZ (UTC)
--   • Soft-deletes via is_active; no hard DELETEs on reference data
--   • Addresses stored as lowercase varchar(42) (EVM) or varchar(66) (StarkNet)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text (email)

-- ---------------------------------------------------------------------------
-- DOMAIN: system_config
-- ---------------------------------------------------------------------------

CREATE TABLE currencies (
    currency_code       VARCHAR(10)  PRIMARY KEY,       -- e.g. 'ZAR', 'USD', 'TTZA', 'ZARP'
    name                VARCHAR(100) NOT NULL,
    currency_symbol     VARCHAR(10),                    -- display symbol e.g. 'R', '$'
    decimals            SMALLINT     NOT NULL DEFAULT 2,
    base_currency_code  VARCHAR(10)  REFERENCES currencies(currency_code),
    -- 'FIAT' | 'STABLECOIN' | 'TREASURY'
    -- FIAT: fiat anchor row only (stablecoin_code is null)
    -- STABLECOIN: tradeable ERC20 (USDC, ZARP)
    -- TREASURY: flash treasury token (TTZA)
    currency_type       VARCHAR(12)  NOT NULL DEFAULT 'FIAT'
                        CHECK (currency_type IN ('FIAT','STABLECOIN','TREASURY')),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE currencies IS
    'Registry of fiat currencies and their on-chain token representations. '
    'FIAT rows are country anchors. STABLECOIN/TREASURY rows link to a stablecoin contract.';

CREATE TABLE countries (
    country_code        VARCHAR(3)   PRIMARY KEY,       -- ISO 3166-1 alpha-2 e.g. 'ZA'
    name                VARCHAR(100) NOT NULL,
    currency_code       VARCHAR(10)  NOT NULL REFERENCES currencies(currency_code),
    vat_rate_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
    dial_code           VARCHAR(6),                     -- e.g. '+27'
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE countries IS
    'Countries in which iMali operates. Controls which products and KYC tiers are available.';

-- Add FK from currencies back to countries (circular, deferred)
ALTER TABLE currencies
    ADD COLUMN country_code VARCHAR(3) REFERENCES countries(country_code) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE stablecoins (
    internal_code       VARCHAR(10)  PRIMARY KEY,       -- e.g. 'TTZA', 'ZARP', 'USDC'
    currency_code       VARCHAR(10)  NOT NULL REFERENCES currencies(currency_code),
    -- EVM address (0x…) or StarkNet address (0x0…)
    contract_address    VARCHAR(66),
    is_primary          BOOLEAN      NOT NULL DEFAULT FALSE,   -- primary token for this fiat
    is_treasury_token   BOOLEAN      NOT NULL DEFAULT FALSE,   -- TRUE for TTZA-style FTTs
    is_deployed         BOOLEAN      NOT NULL DEFAULT FALSE,
    total_supply        NUMERIC(30,8) DEFAULT 0,               -- cached from chain, refreshed by indexer
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE stablecoins IS
    'On-chain token registry. One row per deployed (or pending) ERC20/StarkNet token. '
    'Linked to a currencies row that acts as its fiat peg anchor.';

-- KYC levels are per-country (different jurisdictions have different FICA/AML limits)
CREATE TABLE kyc_levels (
    level_id                SERIAL       PRIMARY KEY,
    country_code            VARCHAR(3)   NOT NULL REFERENCES countries(country_code),
    level_name              VARCHAR(50)  NOT NULL,               -- 'Level 0 (Unverified)', 'Level 1', 'Level 2' ...
    -- Transaction / balance limits (in fiat cents of the country's currency)
    max_single_tx           NUMERIC(20,8),                       -- NULL = no limit
    max_daily_spend         NUMERIC(20,8),
    max_monthly_spend       NUMERIC(20,8),
    max_wallet_balance      NUMERIC(20,8),
    max_daily_send          NUMERIC(20,8),                       -- P2P send limit
    -- Feature gates
    requires_id_doc         BOOLEAN      NOT NULL DEFAULT FALSE,
    requires_biometric      BOOLEAN      NOT NULL DEFAULT FALSE,
    allows_usd_savings      BOOLEAN      NOT NULL DEFAULT FALSE,
    allows_remittance       BOOLEAN      NOT NULL DEFAULT FALSE,
    allows_merchant_spend   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Identity requirements
    idos_credential_required BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (country_code, level_name)
);
COMMENT ON TABLE kyc_levels IS
    'Per-country KYC tier definitions. Limits are stored in smallest fiat units '
    '(cents for ZAR). The application enforces these on every wallet operation.';

-- ---------------------------------------------------------------------------
-- DOMAIN: merchant
-- ---------------------------------------------------------------------------

CREATE TABLE merchants (
    merchant_id             VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name                    VARCHAR(200) NOT NULL,
    country_code            VARCHAR(3)   NOT NULL REFERENCES countries(country_code),
    currency_code           VARCHAR(10)  NOT NULL REFERENCES currencies(currency_code),
    -- On-chain identity
    wallet_address          VARCHAR(66)  UNIQUE,                 -- merchant's settlement wallet
    idos_credential_id      VARCHAR(200),                        -- idOS DID or credential ID
    -- Verification
    verification_status     VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
                            CHECK (verification_status IN ('PENDING','LEVEL_1','LEVEL_2','LEVEL_3','REJECTED')),
    kyc_level_id            INTEGER      REFERENCES kyc_levels(level_id),
    -- Branding (consumer UI theming)
    primary1_color          VARCHAR(7),                          -- hex without #, e.g. 'FF6600'
    primary2_color          VARCHAR(7),
    logo_arweave_id         VARCHAR(100),                        -- Arweave tx ID for logo image
    -- Contact / web
    email                   CITEXT,
    website                 VARCHAR(300),
    -- Settlement
    settlement_currency     VARCHAR(10)  REFERENCES currencies(currency_code),
    -- State
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE merchants IS
    'Merchant accounts. Registered via self-service server UI or admin. '
    'wallet_address links to on-chain settlement contract. '
    'Branding fields drive consumer UI theming for embedded/white-label scenarios.';

CREATE TABLE merchant_offramp_config (
    config_id               VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    merchant_id             VARCHAR(36)  NOT NULL REFERENCES merchants(merchant_id),
    offramp_type            VARCHAR(20)  NOT NULL
                            CHECK (offramp_type IN ('BANK_EFT','PAYSHAP','CRYPTO_WALLET','MANUAL')),
    -- Bank details (for EFT / PayShap)
    bank_name               VARCHAR(100),
    bank_account_number     VARCHAR(50),
    bank_branch_code        VARCHAR(20),
    bank_account_type       VARCHAR(20)  CHECK (bank_account_type IN ('CURRENT','SAVINGS','TRANSMISSION')),
    account_holder_name     VARCHAR(200),
    -- Crypto (for CRYPTO_WALLET off-ramp)
    crypto_wallet_address   VARCHAR(66),
    crypto_network          VARCHAR(50),                         -- 'ethereum', 'starknet', etc.
    -- Preferences
    preferred_settlement_currency VARCHAR(10) REFERENCES currencies(currency_code),
    min_settlement_amount   NUMERIC(20,8),
    auto_settle             BOOLEAN      NOT NULL DEFAULT FALSE,  -- trigger settlement automatically
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE merchant_offramp_config IS
    'Merchant off-ramp and settlement routing config. '
    'A merchant may have multiple configs (e.g. EFT primary, crypto fallback). '
    'Sensitive bank fields should be encrypted at rest (app-level AES-256).';

CREATE TABLE products (
    product_id              VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    merchant_id             VARCHAR(36)  NOT NULL REFERENCES merchants(merchant_id),
    country_code            VARCHAR(3)   NOT NULL REFERENCES countries(country_code),
    currency_code           VARCHAR(10)  NOT NULL REFERENCES currencies(currency_code),
    name                    VARCHAR(200) NOT NULL,
    description             TEXT,
    -- Pricing
    delivery_type           VARCHAR(20)  NOT NULL DEFAULT 'DIRECT'
                            CHECK (delivery_type IN ('DIRECT','VOUCHER','PHYSICAL','VIRTUAL')),
    is_fixed_price          BOOLEAN      NOT NULL DEFAULT TRUE,
    price                   NUMERIC(20,8),                       -- fixed price in fiat cents; NULL if variable
    min_price               NUMERIC(20,8),                       -- for variable price products
    max_price               NUMERIC(20,8),
    incurs_vat              BOOLEAN      NOT NULL DEFAULT TRUE,
    validity_days           INTEGER,                             -- NULL = no expiry
    -- External integration
    external_product_id     VARCHAR(100),                        -- legacy 1V product ID or supplier ID
    supplier_api_code       VARCHAR(100),                        -- maps to legacy API endpoint / product code
    -- Hierarchy (matches 1V division/category/subcategory/group pattern)
    category                VARCHAR(100),
    subcategory             VARCHAR(100),
    -- State
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE products IS
    'Merchant product catalogue. Not stored on-chain. '
    'external_product_id and supplier_api_code link to legacy 1V / third-party APIs for spend fulfilment.';

CREATE TABLE product_skus (
    sku_id                  VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    product_id              VARCHAR(36)  NOT NULL REFERENCES products(product_id),
    sku_name                VARCHAR(200) NOT NULL,
    face_value              NUMERIC(20,8) NOT NULL,              -- consumer-facing value
    cost_price              NUMERIC(20,8),                       -- supplier cost (buy price)
    buy_discount_bps        INTEGER      DEFAULT 0,              -- basis points discount from agreement
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE product_skus IS
    'SKU-level pricing for products with multiple denominations (e.g. R10, R20, R50 airtime). '
    'buy_discount_bps allows per-SKU override of the merchant buy agreement discount.';

-- ---------------------------------------------------------------------------
-- DOMAIN: consumer
-- ---------------------------------------------------------------------------

CREATE TABLE consumers (
    consumer_id             VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    -- Privacy: PII stored only as hashes or in idOS; never plaintext here
    mobile_hash             VARCHAR(64)  UNIQUE,                 -- SHA-256 of normalised mobile number
    display_name_hash       VARCHAR(64),                         -- SHA-256 of display name
    country_code            VARCHAR(3)   NOT NULL REFERENCES countries(country_code),
    kyc_level_id            INTEGER      REFERENCES kyc_levels(level_id),
    -- On-chain identity
    wallet_address          VARCHAR(66)  UNIQUE,                 -- ERC4337 spend wallet
    save_wallet_address     VARCHAR(66),                         -- local currency save wallet
    usd_wallet_address      VARCHAR(66),                         -- USD savings wallet
    idos_credential_id      VARCHAR(200),                        -- idOS DID/credential
    ens_subdomain           VARCHAR(100),                        -- e.g. 'a1b2c3d4.1voucher.eth'
    -- Migration state
    source_system           VARCHAR(20)  NOT NULL DEFAULT 'WEB2'
                            CHECK (source_system IN ('WEB2','ONCHAIN','MIGRATING')),
    legacy_consumer_id      VARCHAR(100),                        -- original 1V consumer ID
    -- State
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE consumers IS
    'Consumer accounts. No PII stored — mobile and name are SHA-256 hashes. '
    'Actual name, mobile, KYC docs live in idOS or legacy web2 DB. '
    'source_system tracks web2/on-chain migration state.';

CREATE TABLE consumer_merchant_links (
    link_id                 VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    consumer_id             VARCHAR(36)  NOT NULL REFERENCES consumers(consumer_id),
    merchant_id             VARCHAR(36)  NOT NULL REFERENCES merchants(merchant_id),
    source_id               VARCHAR(100),                        -- merchant's internal customer ID
    ens_subdomain           VARCHAR(100),                        -- ENS subdomain for this relationship
    linked_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (consumer_id, merchant_id)
);
COMMENT ON TABLE consumer_merchant_links IS
    'Many-to-many link between consumers and merchants. '
    'Mirrors the MerchantConsumer struct from shared.cairo.';

-- ---------------------------------------------------------------------------
-- DOMAIN: events (on-chain index — append-only, built by indexer)
-- ---------------------------------------------------------------------------

CREATE TABLE onchain_events (
    event_id                VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tx_hash                 VARCHAR(66)  NOT NULL,
    event_type              VARCHAR(30)  NOT NULL
                            CHECK (event_type IN (
                                'MINT','BURN','TRANSFER','MERCHANT_PAYMENT',
                                'P2P_SEND','DEPOSIT','WITHDRAW','REFUND',
                                'YIELD_ISSUED','CONTRACT_DEPLOYED'
                            )),
    from_address            VARCHAR(66),
    to_address              VARCHAR(66),
    amount                  NUMERIC(30,8),
    currency_code           VARCHAR(10)  REFERENCES currencies(currency_code),
    -- Resolved foreign keys (NULL if unresolvable — e.g. external wallet)
    consumer_id             VARCHAR(36)  REFERENCES consumers(consumer_id),
    merchant_id             VARCHAR(36)  REFERENCES merchants(merchant_id),
    -- Chain details
    block_number            INTEGER,
    block_timestamp         TIMESTAMPTZ,
    chain_id                INTEGER      DEFAULT 1,              -- 1=mainnet, 11155111=sepolia
    contract_address        VARCHAR(66),
    log_index               INTEGER,
    status                  VARCHAR(20)  NOT NULL DEFAULT 'CONFIRMED'
                            CHECK (status IN ('PENDING','CONFIRMED','FAILED','REORGED')),
    -- Indexer metadata
    indexed_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    raw_log                 JSONB,                               -- full event log for reprocessing
    UNIQUE (tx_hash, log_index)
);
COMMENT ON TABLE onchain_events IS
    'Append-only index of on-chain events, populated by the indexer service. '
    'Used for reporting, compliance, and consumer transaction history. '
    'raw_log preserves the full event data for reprocessing without re-indexing.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- system_config
CREATE INDEX idx_currencies_type        ON currencies(currency_type);
CREATE INDEX idx_countries_active       ON countries(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_kyc_levels_country     ON kyc_levels(country_code);
CREATE INDEX idx_stablecoins_currency   ON stablecoins(currency_code);
CREATE INDEX idx_stablecoins_active     ON stablecoins(is_active) WHERE is_active = TRUE;

-- merchant
CREATE INDEX idx_merchants_country      ON merchants(country_code);
CREATE INDEX idx_merchants_wallet       ON merchants(wallet_address);
CREATE INDEX idx_merchants_status       ON merchants(verification_status);
CREATE INDEX idx_products_merchant      ON products(merchant_id);
CREATE INDEX idx_products_country       ON products(country_code);
CREATE INDEX idx_products_external_id   ON products(external_product_id);
CREATE INDEX idx_product_skus_product   ON product_skus(product_id);

-- consumer
CREATE INDEX idx_consumers_mobile_hash  ON consumers(mobile_hash);
CREATE INDEX idx_consumers_wallet       ON consumers(wallet_address);
CREATE INDEX idx_consumers_country      ON consumers(country_code);
CREATE INDEX idx_consumers_source       ON consumers(source_system);
CREATE INDEX idx_cml_consumer           ON consumer_merchant_links(consumer_id);
CREATE INDEX idx_cml_merchant           ON consumer_merchant_links(merchant_id);

-- events
CREATE INDEX idx_events_type            ON onchain_events(event_type);
CREATE INDEX idx_events_consumer        ON onchain_events(consumer_id);
CREATE INDEX idx_events_merchant        ON onchain_events(merchant_id);
CREATE INDEX idx_events_block           ON onchain_events(block_number);
CREATE INDEX idx_events_currency        ON onchain_events(currency_code);
CREATE INDEX idx_events_from            ON onchain_events(from_address);
CREATE INDEX idx_events_to              ON onchain_events(to_address);

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

-- Fiat currencies (FIAT type rows — country anchors)
INSERT INTO currencies (currency_code, name, currency_symbol, decimals, currency_type) VALUES
    ('ZAR', 'South African Rand',   'R',    2, 'FIAT'),
    ('USD', 'US Dollar',            '$',    2, 'FIAT'),
    ('BWP', 'Botswana Pula',        'P',    2, 'FIAT'),
    ('KES', 'Kenyan Shilling',      'KSh',  2, 'FIAT'),
    ('MWK', 'Malawian Kwacha',      'MK',   2, 'FIAT'),
    ('MZN', 'Mozambican Metical',   'MT',   2, 'FIAT'),
    ('NAD', 'Namibian Dollar',      'N$',   2, 'FIAT'),
    ('NGN', 'Nigerian Naira',       '₦',    2, 'FIAT'),
    ('ZIG', 'Zimbabwe Gold',        'ZiG',  2, 'FIAT');

-- Countries (matching the Countries screenshot)
INSERT INTO countries (country_code, name, currency_code, vat_rate_pct, dial_code) VALUES
    ('ZA', 'South Africa',  'ZAR', 15.00, '+27'),
    ('US', 'United States', 'USD', 12.00, '+1'),
    ('BW', 'Botswana',      'BWP', 14.00, '+267'),
    ('KE', 'Kenya',         'KES', 16.00, '+254'),
    ('MW', 'Malawi',        'MWK', 18.00, '+265'),
    ('MZ', 'Mozambique',    'MZN', 16.00, '+258'),
    ('NA', 'Namibia',       'NAD', 15.00, '+264'),
    ('NG', 'Nigeria',       'NGN',  8.00, '+234'),
    ('ZW', 'Zimbabwe',      'ZIG', 16.00, '+263');

-- On-chain token rows (STABLECOIN + TREASURY)
INSERT INTO currencies (currency_code, name, currency_symbol, decimals, base_currency_code, currency_type) VALUES
    ('TTZA', 'Flash Treasury Token ZAR', 'TTZA', 6, 'ZAR', 'TREASURY'),
    ('ZARP', 'ZAR Stablecoin',           'ZARP', 6, 'ZAR', 'STABLECOIN'),
    ('USDC', 'USD Coin',                 'USDC', 6, 'USD', 'STABLECOIN');

-- Stablecoin contracts (matching Currencies screenshot — contract addresses TBC on deploy)
INSERT INTO stablecoins (internal_code, currency_code, is_primary, is_treasury_token, is_deployed) VALUES
    ('TTZA', 'TTZA', FALSE, TRUE,  TRUE),
    ('ZARP', 'ZARP', FALSE, FALSE, TRUE),
    ('USDC', 'USDC', FALSE, FALSE, TRUE);

-- KYC levels for South Africa (FICA-aligned)
INSERT INTO kyc_levels
    (country_code, level_name, max_single_tx, max_daily_spend, max_monthly_spend,
     max_wallet_balance, max_daily_send, requires_id_doc, requires_biometric,
     allows_usd_savings, allows_remittance, idos_credential_required) VALUES
    ('ZA', 'Level 0 (Unverified)',
     500000,    1000000,   5000000,    5000000,   500000,
     FALSE, FALSE, FALSE, FALSE, FALSE),
    ('ZA', 'Level 1 (Basic ID)',
     2500000,  10000000,  25000000,  25000000,  5000000,
     TRUE,  FALSE, FALSE, FALSE, TRUE),
    ('ZA', 'Level 2 (Full KYC)',
     10000000, 50000000, 200000000, 100000000, 25000000,
     TRUE,  TRUE,  TRUE,  TRUE,  TRUE);

-- Note: amounts above are in ZAR cents
-- Level 0: R5/R10/R50 limits  |  Level 1: R25/R100/R250  |  Level 2: R100/R500/R2000
