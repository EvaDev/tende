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

import express, { Request, Response } from 'express';
import db from './db.js';
import { requireMemberAuth, requireOrgAdmin } from './memberAuth.middleware.js';

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
      `SELECT product_id AS id, name, price, currency_code, icon_id, is_active
         FROM products WHERE merchant_id = $1
        ORDER BY created_at DESC`,
      [req.member!.merchantId],
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/me/products', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const m = await db.query<{ country_code: string; currency_code: string }>(
      `SELECT country_code, currency_code FROM merchants WHERE merchant_id = $1`, [req.member!.merchantId]);
    if (!m.rows.length) { res.status(404).json({ error: 'Merchant not found' }); return; }

    const { name, unitPrice } = req.body as { name?: string; unitPrice?: number | string };
    if (!name?.trim()) { res.status(400).json({ error: 'Product name is required' }); return; }
    const price = Number(unitPrice);
    if (!(price > 0)) { res.status(400).json({ error: 'Unit price must be a positive number' }); return; }
    const cents = Math.round(price * 100); // products store minor units (cents)

    const { country_code, currency_code } = m.rows[0];
    const r = await db.query(
      `INSERT INTO products
         (merchant_id, country_code, currency_code, name, delivery_type, is_fixed_price, price, min_price, max_price, incurs_vat, is_active)
       VALUES ($1,$2,$3,$4,'DIRECT',TRUE,$5,$5,$5,FALSE,TRUE)
       RETURNING product_id AS id, name, price, currency_code, is_active`,
      [req.member!.merchantId, country_code, currency_code, name.trim(), cents],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Sales (POS ledger + store/till rollup) ───────────────────────────────────
router.get('/me/sales', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.member!.merchantId;
    const sales = await db.query(
      `SELECT sale_id, amount, currency, store_number, till_number, latitude, longitude,
              items, consumer_tag, consumer_wallet, tx_hash, status, created_at
         FROM merchant_sales WHERE merchant_id = $1
        ORDER BY created_at DESC LIMIT 500`,
      [merchantId],
    );
    const byStoreTill = await db.query(
      `SELECT COALESCE(store_number, '—') AS store_number,
              COALESCE(till_number, '—')  AS till_number,
              currency,
              count(*)::int    AS sales,
              SUM(amount)::text AS total,
              MAX(created_at)  AS last_sale
         FROM merchant_sales WHERE merchant_id = $1
        GROUP BY store_number, till_number, currency
        ORDER BY SUM(amount) DESC`,
      [merchantId],
    );
    res.json({ sales: sales.rows, byStoreTill: byStoreTill.rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
