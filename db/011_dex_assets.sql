-- Shift tradeable assets from broker/float to non-custodial DEX swaps.
-- Consumers swap their own USDC↔asset on Uniswap; the platform curates liquid
-- assets, prices them from the Uniswap Quoter, and adds a per-asset markup.
-- The broker ledger (platform-held positions) is removed — holdings are now
-- simply the on-chain balance in the consumer's own Safe wallet.

ALTER TABLE tradeable_assets
  ADD COLUMN IF NOT EXISTS quote_token   VARCHAR(20) NOT NULL DEFAULT 'USDC',  -- settlement currency
  ADD COLUMN IF NOT EXISTS pool_fee_tier INTEGER     NOT NULL DEFAULT 3000,    -- Uniswap V3 fee tier (bps*100)
  ADD COLUMN IF NOT EXISTS markup_bps    SMALLINT    NOT NULL DEFAULT 0;       -- platform markup on swaps (basis points)

-- Allow 'dex_quote' as a price source.
ALTER TABLE tradeable_assets DROP CONSTRAINT IF EXISTS tradeable_assets_price_source_check;
ALTER TABLE tradeable_assets ADD CONSTRAINT tradeable_assets_price_source_check
  CHECK (price_source IN ('manual','api','dex_quote','chainlink'));

-- Example gold tokens now priced live from Uniswap (PAXG/USDC 0.05% pool is deepest).
UPDATE tradeable_assets SET price_source='dex_quote', pool_fee_tier=500  WHERE symbol='PAXG';
UPDATE tradeable_assets SET price_source='dex_quote', pool_fee_tier=3000 WHERE symbol='XAUT';

-- Broker ledger superseded by self-custody (asset lives in the consumer's wallet).
DROP TABLE IF EXISTS asset_trades;
DROP TABLE IF EXISTS asset_holdings;
