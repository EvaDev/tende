// src/merchantSelf.routes.ts
// Merchant self-service for OPERATORS (member-auth model), mounted at
// /api/merchant/me — distinct from the wallet-based /api/merchants/me in
// merchants.routes.ts (kept as-is for any merchant still wallet-connecting).
// Same underlying tables (merchants/merchant_logos/products/merchant_sales);
// the only difference is resolving the merchant by req.member.merchantId
// (already in the JWT — no wallet lookup needed) instead of by wallet address.
//
// Profile/logo edits (business identity) are org_admin only; viewing and
// ringing up products/sales is open to any operator (cashiers run the POS).
// Product catalog edits (add/deactivate) are org_admin only.

import express, { Request, Response } from 'express';
import db from './db.js';
import { requireMemberAuth, requireOrgAdmin } from './memberAuth.middleware.js';
import { parseProductBody, mapProductRow, PRODUCT_SELECT } from './productHelpers.js';
import { prepareChangeVoucher, sendChangeVoucherToTag } from './changeVoucherService.js';
import { createMerchantStore, listMerchantStores, listProductCorridors, resolveProductCorridor, updateMerchantStore } from './storeService.js';
import { SQL_STORE_LABEL, SQL_TILL_LABEL } from './salesLabels.js';

const router = express.Router();

// ── GET /api/merchant/me ──────────────────────────────────────────────────────
router.get('/me', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT merchant_id, name, wallet_address, country_code, currency_code,
              email, address, contact_person, settlement_type, settlement_currency,
              icon_id, verification_status, created_at
       FROM merchants WHERE merchant_id = $1`,
      [req.member!.merchantId],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Merchant not found' }); return; }
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/merchant/me ───────────────────────────────────────────────────  (org_admin)
router.patch('/me', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.member!.merchantId;
    const cur = await db.query<{ currency_code: string }>(
      `SELECT currency_code FROM merchants WHERE merchant_id = $1`, [merchantId]);
    if (!cur.rows.length) { res.status(404).json({ error: 'Merchant not found' }); return; }

    const fieldMap: Record<string, string> = {
      name: 'name', contactPerson: 'contact_person', email: 'email',
      address: 'address', settlementType: 'settlement_type', iconId: 'icon_id',
    };
    const updates: Record<string, unknown> = {};
    for (const [bodyKey, col] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] === undefined) continue;
      let val = req.body[bodyKey];
      if (col === 'name' && !String(val ?? '').trim()) { res.status(400).json({ error: 'Business name cannot be empty' }); return; }
      if (col === 'settlement_type') {
        if (!['FIAT', 'ONCHAIN'].includes(val)) { res.status(400).json({ error: 'settlementType must be FIAT or ONCHAIN' }); return; }
        updates.settlement_currency = val === 'ONCHAIN' ? 'USDC' : cur.rows[0].currency_code;
      }
      if (col === 'icon_id') val = val != null ? Number(val) : null;
      updates[col] = val;
    }
    if (!Object.keys(updates).length) { res.status(400).json({ error: 'Nothing to update' }); return; }

    const cols   = Object.keys(updates);
    const sets   = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const result = await db.query(
      `UPDATE merchants SET ${sets}, updated_at = NOW() WHERE merchant_id = $1
       RETURNING merchant_id, name, wallet_address, country_code, currency_code,
                 email, address, contact_person, settlement_type, settlement_currency,
                 icon_id, verification_status, created_at`,
      [merchantId, ...cols.map(c => updates[c])],
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Logo ──────────────────────────────────────────────────────────────────────
router.get('/me/logo', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(`SELECT mime_type, data_base64 FROM merchant_logos WHERE merchant_id = $1`, [req.member!.merchantId]);
    if (!r.rows.length) { res.status(404).json({ error: 'No logo' }); return; }
    const { mime_type, data_base64 } = r.rows[0] as { mime_type: string; data_base64: string };
    const buf = Buffer.from(data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    res.setHeader('Content-Type', mime_type);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(buf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put('/me/logo', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { data_base64, mime_type } = req.body as { data_base64?: string; mime_type?: string };
    if (!data_base64) { res.status(400).json({ error: 'data_base64 required' }); return; }
    const mime = mime_type ?? data_base64.match(/^data:([^;]+);/)?.[1] ?? 'image/png';
    await db.query(
      `INSERT INTO merchant_logos (merchant_id, mime_type, data_base64)
       VALUES ($1,$2,$3)
       ON CONFLICT (merchant_id) DO UPDATE SET mime_type=$2, data_base64=$3, updated_at=NOW()`,
      [req.member!.merchantId, mime, data_base64],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Products (POS catalog) ────────────────────────────────────────────────────
router.get('/me/products', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT ${PRODUCT_SELECT}
         FROM products WHERE merchant_id = $1
        ORDER BY created_at DESC`,
      [req.member!.merchantId],
    );
    res.json(r.rows.map(row => mapProductRow(row as Record<string, unknown>)));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/me/products', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.member!.merchantId;
    const body = req.body as import('./productHelpers.js').ProductBody & { currencyCode?: string; countryCode?: string };

    const parsed = parseProductBody(body, false);
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }

    const corridors = await listProductCorridors(merchantId);
    const defaultCorridor = corridors[0];
    const corridor = await resolveProductCorridor(
      merchantId,
      body.currencyCode ?? defaultCorridor.currencyCode,
      body.countryCode,
    );

    const cols = ['merchant_id', 'country_code', 'currency_code', ...Object.keys(parsed.fields), 'is_active'];
    const vals = [merchantId, corridor.countryCode, corridor.currencyCode, ...Object.values(parsed.fields), true];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');

    const r = await db.query(
      `INSERT INTO products (${cols.join(', ')})
       VALUES (${placeholders})
       RETURNING ${PRODUCT_SELECT}`,
      vals,
    );
    res.status(201).json(mapProductRow(r.rows[0] as Record<string, unknown>));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message });
  }
});

router.patch('/me/products/:id', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.member!.merchantId;
    const body = req.body as import('./productHelpers.js').ProductBody & { currencyCode?: string; countryCode?: string };

    const parsed = parseProductBody(body, true);
    if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }

    if (body.currencyCode) {
      const corridor = await resolveProductCorridor(merchantId, body.currencyCode, body.countryCode);
      parsed.fields.country_code = corridor.countryCode;
      parsed.fields.currency_code = corridor.currencyCode;
    }

    if (!Object.keys(parsed.fields).length) { res.status(400).json({ error: 'Nothing to update' }); return; }

    const cols = Object.keys(parsed.fields);
    const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    const r = await db.query(
      `UPDATE products SET ${sets}, updated_at = NOW()
       WHERE product_id = $1 AND merchant_id = $2
       RETURNING ${PRODUCT_SELECT}`,
      [req.params.id, merchantId, ...Object.values(parsed.fields)],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Product not found in your catalog' }); return; }
    res.json(mapProductRow(r.rows[0] as Record<string, unknown>));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ── Product corridors (country + fiat from stores) ───────────────────────────
router.get('/me/products/corridors', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const corridors = await listProductCorridors(req.member!.merchantId);
    res.json(corridors.map(c => ({
      countryCode: c.countryCode,
      currencyCode: c.currencyCode,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Stores (country + fiat per location) ───────────────────────────────────────
router.get('/me/stores', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const stores = await listMerchantStores(req.member!.merchantId, req.member!.memberId);
    res.json(stores.map(s => ({
      id: s.store_id,
      storeCode: s.store_code,
      name: s.name,
      countryCode: s.country_code,
      currencyCode: s.currency_code,
      isActive: s.is_active,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/me/stores', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeCode, name, countryCode } = req.body as Record<string, string>;
    const store = await createMerchantStore(req.member!.merchantId, { storeCode, name, countryCode });
    res.status(201).json({
      id: store.store_id,
      storeCode: store.store_code,
      name: store.name,
      countryCode: store.country_code,
      currencyCode: store.currency_code,
      isActive: store.is_active,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message });
  }
});

router.patch('/me/stores/:id', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, countryCode, isActive } = req.body as { name?: string; countryCode?: string; isActive?: boolean };
    const store = await updateMerchantStore(req.member!.merchantId, String(req.params.id), { name, countryCode, isActive });
    res.json({
      id: store.store_id,
      storeCode: store.store_code,
      name: store.name,
      countryCode: store.country_code,
      currencyCode: store.currency_code,
      isActive: store.is_active,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ── Change vouchers (digital change at till) ───────────────────────────────────
router.post('/me/change-voucher/prepare', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, productId, storeId, tillNumber } = req.body as Record<string, string>;
    if (!amount) { res.status(400).json({ error: 'amount required' }); return; }
    const result = await prepareChangeVoucher({
      merchantId: req.member!.merchantId,
      memberId: req.member!.memberId,
      amount,
      productId,
      storeId,
      tillNumber,
    });
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message });
  }
});

router.post('/me/change-voucher/send', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { tag, amount, productId, storeId, tillNumber } = req.body as Record<string, string>;
    if (!tag || !amount) { res.status(400).json({ error: 'tag and amount required' }); return; }
    const result = await sendChangeVoucherToTag({
      merchantId: req.member!.merchantId,
      memberId: req.member!.memberId,
      tag,
      amount,
      productId,
      storeId,
      tillNumber,
    });
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ── Dashboard summary (sales + change vouchers) ───────────────────────────────
router.get('/me/dashboard-summary', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.member!.merchantId;
    const [salesAgg, byStoreTill, changeVouchers] = await Promise.all([
      db.query<{ transactions: number; total: string; currency: string | null }>(
        `SELECT count(*)::int AS transactions,
                COALESCE(SUM(amount), 0)::text AS total,
                (SELECT currency FROM merchant_sales WHERE merchant_id = $1
                  ORDER BY created_at DESC LIMIT 1) AS currency
           FROM merchant_sales WHERE merchant_id = $1`,
        [merchantId],
      ),
      db.query(
        `SELECT ${SQL_STORE_LABEL} AS store_number,
                ${SQL_TILL_LABEL} AS till_number,
                currency
           FROM merchant_sales WHERE merchant_id = $1
          GROUP BY ${SQL_STORE_LABEL}, ${SQL_TILL_LABEL}, currency`,
        [merchantId],
      ),
      db.query<{ issued: number; total_minor: string; currency: string | null }>(
        `SELECT count(*)::int AS issued,
                COALESCE(SUM(amount), 0)::text AS total_minor,
                (SELECT currency FROM change_vouchers WHERE merchant_id = $1
                   AND status IN ('claimed', 'pending')
                 ORDER BY created_at DESC LIMIT 1) AS currency
           FROM change_vouchers
          WHERE merchant_id = $1 AND status IN ('claimed', 'pending')`,
        [merchantId],
      ),
    ]);
    const row = salesAgg.rows[0];
    const cv = changeVouchers.rows[0];
    const cvCurrency = cv?.currency ?? row?.currency ?? 'ZAR';
    const cvDecimals = cvCurrency === 'USDC' || cvCurrency === 'USD' ? 6 : 2;
    const cvTotalMajor = cv
      ? (Number(cv.total_minor) / 10 ** cvDecimals).toFixed(2)
      : '0';
    res.json({
      sales: {
        total: row?.total ?? '0',
        currency: row?.currency ?? 'ZAR',
        transactions: row?.transactions ?? 0,
        tillsActive: byStoreTill.rows.length,
      },
      changeVouchers: {
        issued: cv?.issued ?? 0,
        total: cvTotalMajor,
        currency: cvCurrency,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Sales (POS ledger + store/till rollup) ───────────────────────────────────
router.get('/me/sales', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.member!.merchantId;
    const sales = await db.query(
      `SELECT sale_id, amount, currency, charge_amount, charge_currency, fx_rate,
              ${SQL_STORE_LABEL} AS store_number,
              ${SQL_TILL_LABEL} AS till_number,
              latitude, longitude, items, consumer_tag, consumer_wallet, tx_hash, status, created_at
         FROM merchant_sales WHERE merchant_id = $1
        ORDER BY created_at DESC LIMIT 500`,
      [merchantId],
    );
    const byStoreTill = await db.query(
      `SELECT ${SQL_STORE_LABEL} AS store_number,
              ${SQL_TILL_LABEL} AS till_number,
              currency,
              count(*)::int    AS sales,
              SUM(amount)::text AS total,
              MAX(created_at)  AS last_sale
         FROM merchant_sales WHERE merchant_id = $1
        GROUP BY ${SQL_STORE_LABEL}, ${SQL_TILL_LABEL}, currency
        ORDER BY SUM(amount) DESC`,
      [merchantId],
    );
    res.json({ sales: sales.rows, byStoreTill: byStoreTill.rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
