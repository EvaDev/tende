// src/fxService.ts
// FX rate lookup for remittance corridors.
//
// Resolution order (per product decision — live API + admin override):
//   1. Admin override in fx_rate_overrides  → use it verbatim (authoritative)
//   2. Live provider (if FX_PROVIDER_API_KEY set), cached for fx.cacheTtlMs
//        - ZimRate for ZWG/ZIG pairs (official RBZ rates)
//        - open.er-api for major fiat pairs
//   3. No override and no usable live rate → { rate: null, source: 'unavailable' }
//
// The DB stores Zimbabwe Gold as 'ZIG'; ZimRate's API uses the ISO code 'ZWG'.
// We map between them only at the provider boundary.

import config from './config.js';
import db from './db.js';

export interface FxQuote {
  from: string;
  to: string;
  rate: number | null;
  source: 'override' | 'zimrate' | 'majors' | 'unavailable';
  asOf: string | null;
}

interface CacheEntry { rate: number; source: FxQuote['source']; expiresAt: number; asOf: string }
const cache = new Map<string, CacheEntry>();

// DB currency code → provider ISO code
function toProviderCode(code: string): string {
  return code === 'ZIG' ? 'ZWG' : code;
}

function cacheKey(from: string, to: string): string { return `${from}/${to}`; }

async function getOverride(from: string, to: string): Promise<number | null> {
  const r = await db.query<{ rate: string }>(
    `SELECT rate FROM fx_rate_overrides WHERE from_currency = $1 AND to_currency = $2`,
    [from, to],
  );
  return r.rows.length ? Number(r.rows[0].rate) : null;
}

// ZimRate: GET {zimrateUrl}?pair=USD/ZWG  with Bearer auth → { rate: number, ... }
async function fetchZimrate(from: string, to: string): Promise<number | null> {
  if (!config.fx.apiKey) return null;
  const pair = `${toProviderCode(from)}/${toProviderCode(to)}`;
  const url  = `${config.fx.zimrateUrl}?pair=${encodeURIComponent(pair)}`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${config.fx.apiKey}` } });
  if (!res.ok) throw new Error(`ZimRate ${res.status}`);
  const body = await res.json() as { rate?: number; data?: { rate?: number } };
  const rate = body.rate ?? body.data?.rate ?? null;
  return typeof rate === 'number' ? rate : null;
}

// open.er-api: GET {majorsUrl}/{from} → { rates: { TO: number } }  (no key needed)
async function fetchMajors(from: string, to: string): Promise<number | null> {
  const res = await fetch(`${config.fx.majorsUrl}/${toProviderCode(from)}`);
  if (!res.ok) throw new Error(`majors ${res.status}`);
  const body = await res.json() as { rates?: Record<string, number> };
  const rate = body.rates?.[toProviderCode(to)];
  return typeof rate === 'number' ? rate : null;
}

const ZIM_CODES = new Set(['ZIG', 'ZWG']);

async function fetchLive(from: string, to: string): Promise<{ rate: number; source: FxQuote['source'] } | null> {
  const useZimrate = ZIM_CODES.has(from) || ZIM_CODES.has(to);
  const rate = useZimrate ? await fetchZimrate(from, to) : await fetchMajors(from, to);
  if (rate == null) return null;
  return { rate, source: useZimrate ? 'zimrate' : 'majors' };
}

export const fxService = {
  async getRate(fromRaw: string, toRaw: string): Promise<FxQuote> {
    const from = fromRaw.toUpperCase();
    const to   = toRaw.toUpperCase();

    if (from === to) return { from, to, rate: 1, source: 'override', asOf: null };

    // 1. Admin override wins
    const override = await getOverride(from, to);
    if (override != null) {
      return { from, to, rate: override, source: 'override', asOf: null };
    }

    // 2. Cached live rate
    const key    = cacheKey(from, to);
    const cached = cache.get(key);
    const nowMs  = Date.now();
    if (cached && cached.expiresAt > nowMs) {
      return { from, to, rate: cached.rate, source: cached.source, asOf: cached.asOf };
    }

    // 3. Fetch live
    try {
      const live = await fetchLive(from, to);
      if (live) {
        const asOf = new Date(nowMs).toISOString();
        cache.set(key, { rate: live.rate, source: live.source, expiresAt: nowMs + config.fx.cacheTtlMs, asOf });
        return { from, to, rate: live.rate, source: live.source, asOf };
      }
    } catch (err) {
      console.warn(`[fx] live lookup failed for ${from}/${to}:`, (err as Error).message);
    }

    return { from, to, rate: null, source: 'unavailable', asOf: null };
  },
};

export default fxService;
