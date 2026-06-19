// src/reference.routes.ts
// Public read-only reference data the consumer app needs before/without auth:
// currencies, currency types, corridors, payout partners, KYC option lists, FX rates.
// Writes for these live in admin.routes.ts (wallet-signed).

import express, { Request, Response } from 'express';
import db from './db.js';
import fxService from './fxService.js';
import dexQuoteService, { priceWithMarkup } from './dexQuoteService.js';

const router = express.Router();

// ── Countries (active only) ──────────────────────────────────────────────────
router.get('/countries', async (_req: Request, res: Response): Promise<void> => {
  const r = await db.query(
    `SELECT country_code AS code, name, dial_code, currency_code
     FROM countries WHERE is_active = TRUE ORDER BY name`,
  );
  res.json(r.rows);
});

// ── Currencies (enabled only) ────────────────────────────────────────────────
router.get('/currencies', async (_req: Request, res: Response): Promise<void> => {
  const r = await db.query(
    `SELECT currency_code AS code, name, currency_symbol AS symbol, decimals, currency_type
     FROM currencies WHERE is_active = TRUE ORDER BY currency_type, currency_code`,
  );
  res.json(r.rows);
});

// ── Currency types (lookup + badge colours) ──────────────────────────────────
router.get('/currency-types', async (_req: Request, res: Response): Promise<void> => {
  const r = await db.query(
    `SELECT type_code, label, badge_class FROM currency_types ORDER BY sort_order`,
  );
  res.json(r.rows);
});

// ── Corridors (optionally filtered by send country) ──────────────────────────
router.get('/corridors', async (req: Request, res: Response): Promise<void> => {
  const from = (req.query.from as string | undefined)?.toUpperCase();
  const r = await db.query(
    `SELECT c.send_country_code, c.receive_country_code, c.status, c.sort_order,
            rc.name AS receive_country_name,
            sc.currency_code   AS send_currency,    scur.currency_symbol AS send_symbol,
            rc.currency_code   AS receive_currency, rcur.currency_symbol AS receive_symbol
     FROM corridors c
     JOIN countries  rc   ON rc.country_code   = c.receive_country_code
     JOIN countries  sc   ON sc.country_code   = c.send_country_code
     JOIN currencies scur ON scur.currency_code = sc.currency_code
     JOIN currencies rcur ON rcur.currency_code = rc.currency_code
     ${from ? 'WHERE c.send_country_code = $1' : ''}
     ORDER BY c.sort_order`,
    from ? [from] : [],
  );
  res.json(r.rows);
});

// ── Payout partners for a receive country (optionally by method) ─────────────
router.get('/corridors/:receive/partners', async (req: Request, res: Response): Promise<void> => {
  const receive = String(req.params.receive).toUpperCase();
  const method  = req.query.method as string | undefined;
  const r = await db.query(
    `SELECT partner_id, method, name FROM payout_partners
     WHERE receive_country_code = $1 AND is_active = TRUE
     ${method ? 'AND method = $2' : ''}
     ORDER BY method, sort_order`,
    method ? [receive, method] : [receive],
  );
  res.json(r.rows);
});

// ── KYC option lists (occupation | income_source | relationship) ─────────────
router.get('/kyc-options', async (req: Request, res: Response): Promise<void> => {
  const category = req.query.category as string | undefined;
  const r = await db.query(
    `SELECT option_id, category, label FROM kyc_options
     WHERE is_active = TRUE ${category ? 'AND category = $1' : ''}
     ORDER BY category, sort_order`,
    category ? [category] : [],
  );
  res.json(r.rows);
});

// ── Tradeable assets (enabled only, with live price + markup) ─────────────────
router.get('/assets', async (_req: Request, res: Response): Promise<void> => {
  const r = await db.query<Record<string, unknown>>(
    `SELECT asset_id, symbol, name, asset_class, issuer, decimals, contract_address, chain_id,
            price_usd, price_source, price_updated_at, quote_token, pool_fee_tier, markup_bps,
            buy_enabled, sell_enabled, min_trade_usd, max_trade_usd, min_kyc_tier
     FROM tradeable_assets WHERE enabled = TRUE ORDER BY sort_order, symbol`,
  );
  res.json(await Promise.all(r.rows.map(enrichAssetPrice)));
});

// Resolve the base USD price (live DEX quote for 'dex_quote', else stored manual)
// and the consumer-facing price including the platform markup.
async function enrichAssetPrice(a: Record<string, unknown>): Promise<Record<string, unknown>> {
  const markupBps = Number(a.markup_bps ?? 0);
  let basePrice: number | null = a.price_usd != null ? Number(a.price_usd) : null;
  let priceSourceLive: string | null = null;

  if (a.price_source === 'dex_quote') {
    const q = await dexQuoteService.getPriceUsd({
      contract_address: String(a.contract_address),
      decimals:         Number(a.decimals),
      pool_fee_tier:    Number(a.pool_fee_tier),
    });
    basePrice = q.priceUsd;
    priceSourceLive = q.asOf;
  }

  return {
    ...a,
    base_price_usd:   basePrice,
    markup_bps:       markupBps,
    price_with_markup: basePrice != null ? priceWithMarkup(basePrice, markupBps) : null,
    price_as_of:      priceSourceLive,
  };
}

// ── FX rate quote ─────────────────────────────────────────────────────────────
router.get('/fx/rate', async (req: Request, res: Response): Promise<void> => {
  const from = req.query.from as string | undefined;
  const to   = req.query.to as string | undefined;
  if (!from || !to) { res.status(400).json({ error: 'from and to query params required' }); return; }
  res.json(await fxService.getRate(from, to));
});

export default router;
