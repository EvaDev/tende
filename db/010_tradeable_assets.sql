-- Generic tradeable-asset registry: any ERC-20 a consumer may buy/sell
-- (gold tokens, tokenised equities, crypto), whitelisted by an admin.
-- Execution is broker/float + ledger; pricing is pluggable (manual today,
-- off-chain API or Chainlink later) — no schema change needed to switch source.

CREATE TABLE IF NOT EXISTS tradeable_assets (
  asset_id         SERIAL        PRIMARY KEY,
  symbol           VARCHAR(20)   NOT NULL,
  name             VARCHAR(100)  NOT NULL,
  asset_class      VARCHAR(12)   NOT NULL DEFAULT 'COMMODITY'
                   CHECK (asset_class IN ('COMMODITY','EQUITY','CRYPTO','STABLECOIN')),
  contract_address VARCHAR(66)   NOT NULL,
  chain_id         INTEGER       NOT NULL,
  decimals         SMALLINT      NOT NULL DEFAULT 18,
  issuer           VARCHAR(80),

  -- Pluggable price source. 'manual' uses price_usd directly; 'api'/'chainlink'
  -- would refresh price_usd from price_ref via a service (future).
  price_source     VARCHAR(12)   NOT NULL DEFAULT 'manual'
                   CHECK (price_source IN ('manual','api','chainlink')),
  price_usd        NUMERIC(30,8),
  price_ref        VARCHAR(120),
  price_updated_at TIMESTAMPTZ,

  -- Whitelisting + trade controls
  enabled          BOOLEAN       NOT NULL DEFAULT FALSE,   -- listed/whitelisted
  buy_enabled      BOOLEAN       NOT NULL DEFAULT TRUE,
  sell_enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
  min_trade_usd    NUMERIC(20,2) NOT NULL DEFAULT 0,
  max_trade_usd    NUMERIC(20,2),
  min_kyc_tier     SMALLINT      NOT NULL DEFAULT 0,

  sort_order       SMALLINT      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, contract_address)
);

-- Per-consumer net positions (broker ledger).
CREATE TABLE IF NOT EXISTS asset_holdings (
  consumer_id   VARCHAR(36)    NOT NULL REFERENCES consumers(consumer_id),
  asset_id      INTEGER        NOT NULL REFERENCES tradeable_assets(asset_id),
  quantity      NUMERIC(40,18) NOT NULL DEFAULT 0,
  avg_cost_usd  NUMERIC(30,8)  NOT NULL DEFAULT 0,   -- average cost per unit
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_id, asset_id)
);

-- Immutable trade log.
CREATE TABLE IF NOT EXISTS asset_trades (
  trade_id    BIGSERIAL      PRIMARY KEY,
  consumer_id VARCHAR(36)    NOT NULL REFERENCES consumers(consumer_id),
  asset_id    INTEGER        NOT NULL REFERENCES tradeable_assets(asset_id),
  side        VARCHAR(4)     NOT NULL CHECK (side IN ('buy','sell')),
  quantity    NUMERIC(40,18) NOT NULL,
  price_usd   NUMERIC(30,8)  NOT NULL,
  usd_amount  NUMERIC(30,8)  NOT NULL,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_trades_consumer ON asset_trades(consumer_id);

-- Example gold tokens (mainnet), listed but DISABLED until an admin enables them
-- and sets a manual price. Gives the admin real examples to whitelist.
INSERT INTO tradeable_assets (symbol, name, asset_class, contract_address, chain_id, decimals, issuer, sort_order) VALUES
  ('PAXG', 'Pax Gold',    'COMMODITY', '0x45804880De22913dAFE09f4980848ECE6EcbAf78', 1, 18, 'Paxos',  1),
  ('XAUT', 'Tether Gold', 'COMMODITY', '0x68749665FF8D2d112Fa859AA293F07A622782F38', 1,  6, 'Tether', 2)
ON CONFLICT (chain_id, contract_address) DO NOTHING;
