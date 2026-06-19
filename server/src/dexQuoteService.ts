// src/dexQuoteService.ts
// Live USD pricing for tradeable assets via the Uniswap V3 QuoterV2 — read-only
// (eth_call), no oracle, no transaction, no gas. Prices the deepest pool the
// admin selected (pool_fee_tier) by quoting 1 token → USDC on mainnet.
//
// This is the price the consumer would execute at on Uniswap; the platform's
// markup_bps is applied on top at quote/display time (see priceWithMarkup).

import { ethers } from 'ethers';
import config from './config.js';

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 ticksCrossed, uint256 gasEstimate)',
];

export interface AssetPriceInput {
  contract_address: string;
  decimals: number;
  pool_fee_tier: number;
  quote_token?: string; // currently only USDC supported
}

export interface AssetPrice { priceUsd: number | null; source: 'dex_quote'; asOf: string | null }

interface CacheEntry { priceUsd: number; expiresAt: number; asOf: string }
const cache = new Map<string, CacheEntry>();

let _provider: ethers.JsonRpcProvider | null = null;
function provider(): ethers.JsonRpcProvider {
  // Listed assets have liquidity on mainnet — quote there regardless of CHAIN_ID.
  if (!_provider) _provider = new ethers.JsonRpcProvider(config.chain.mainnetRpcUrl);
  return _provider;
}

export const dexQuoteService = {
  async getPriceUsd(asset: AssetPriceInput): Promise<AssetPrice> {
    const key   = `${asset.contract_address.toLowerCase()}:${asset.pool_fee_tier}`;
    const nowMs = Date.now();
    const hit   = cache.get(key);
    if (hit && hit.expiresAt > nowMs) return { priceUsd: hit.priceUsd, source: 'dex_quote', asOf: hit.asOf };

    try {
      const quoter  = new ethers.Contract(config.dex.quoterV2, QUOTER_ABI, provider());
      const amountIn = ethers.parseUnits('1', asset.decimals); // 1 whole token
      const out = await quoter.quoteExactInputSingle.staticCall({
        tokenIn:  asset.contract_address,
        tokenOut: config.dex.usdcAddress,
        amountIn,
        fee:      asset.pool_fee_tier,
        sqrtPriceLimitX96: 0,
      });
      const priceUsd = Number(ethers.formatUnits(out[0] as bigint, config.dex.usdcDecimals));
      const asOf = new Date(nowMs).toISOString();
      cache.set(key, { priceUsd, expiresAt: nowMs + config.dex.cacheTtlMs, asOf });
      return { priceUsd, source: 'dex_quote', asOf };
    } catch (err) {
      console.warn(`[dex] quote failed for ${asset.contract_address} fee=${asset.pool_fee_tier}:`, (err as Error).message);
      return { priceUsd: null, source: 'dex_quote', asOf: null };
    }
  },
};

// Apply the platform markup (basis points) to a base price for the consumer.
export function priceWithMarkup(priceUsd: number, markupBps: number): number {
  return priceUsd * (1 + markupBps / 10_000);
}

export default dexQuoteService;
