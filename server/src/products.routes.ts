// src/products.routes.js
// Product catalogue for the server UI and consumer browse screen.
//
// Public:
//   GET /api/products                  — list active products (with SKUs)
//   GET /api/products/:id              — single product with SKUs
//
// Admin:
//   POST  /api/products                — create product
//   PATCH /api/products/:id            — update product
//   POST  /api/products/:id/skus       — add SKU
//   PATCH /api/products/:id/skus/:skuId — update SKU

import express, { Request, Response } from 'express';
import db      from './db.js';
import { requireAdmin } from './admin.middleware.js';

const router = express.Router();

// ── GET /api/products ─────────────────────────────────────────────────────────

router.get('/', async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  try {
    const merchant  = req.query.merchant  as string | undefined;
    const country   = req.query.country   as string | undefined;
    const category  = req.query.category  as string | undefined;
    const conditions = ['p.is_active = TRUE'];
    const values     = [];

    if (merchant) { values.push(merchant); conditions.push(`p.merchant_id = $${values.length}`); }
    if (country)  { values.push(country.toUpperCase()); conditions.push(`p.country_code = $${values.length}`); }
    if (category) { values.push(category); conditions.push(`p.category = $${values.length}`); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await db.query(
      `SELECT
         p.*,
         json_agg(
           json_build_object(
             'sku_id',         s.sku_id,
             'sku_name',       s.sku_name,
             'face_value',     s.face_value,
             'is_active',      s.is_active
           ) ORDER BY s.face_value
         ) FILTER (WHERE s.sku_id IS NOT NULL AND s.is_active = TRUE) AS skus
       FROM products p
       LEFT JOIN product_skus s ON s.product_id = p.product_id
       ${where}
       GROUP BY p.product_id
       ORDER BY p.category, p.name`,
      values,
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────

router.get('/:id', async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  try {
    const result = await db.query(
      `SELECT p.*,
         json_agg(s.* ORDER BY s.face_value) FILTER (WHERE s.sku_id IS NOT NULL) AS skus
       FROM products p
       LEFT JOIN product_skus s ON s.product_id = p.product_id
       WHERE p.product_id = $1
       GROUP BY p.product_id`,
      [req.params.id],
    );
    if (!result.rows.length) res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/products ────────────────────────────────────────────────────────

router.post('/', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const {
    merchant_id, country_code, currency_code, name, description,
    delivery_type, is_fixed_price, price, min_price, max_price,
    incurs_vat, validity_days, external_product_id, supplier_api_code,
    category, subcategory,
  } = req.body;

  if (!merchant_id || !country_code || !currency_code || !name) {
    res.status(400).json({ error: 'merchant_id, country_code, currency_code, name required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO products
         (merchant_id, country_code, currency_code, name, description,
          delivery_type, is_fixed_price, price, min_price, max_price,
          incurs_vat, validity_days, external_product_id, supplier_api_code,
          category, subcategory)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        merchant_id, country_code.toUpperCase(), currency_code.toUpperCase(),
        name, description ?? null,
        delivery_type ?? 'DIRECT', is_fixed_price ?? true,
        price ?? null, min_price ?? null, max_price ?? null,
        incurs_vat ?? true, validity_days ?? null,
        external_product_id ?? null, supplier_api_code ?? null,
        category ?? null, subcategory ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/products/:id ───────────────────────────────────────────────────

router.patch('/:id', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed = [
    'name', 'description', 'delivery_type', 'is_fixed_price', 'price',
    'min_price', 'max_price', 'incurs_vat', 'validity_days',
    'external_product_id', 'supplier_api_code', 'category', 'subcategory', 'is_active',
  ];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [req.params.id, ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE products SET ${sets}, updated_at = NOW() WHERE product_id = $1 RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/products/:id/skus ───────────────────────────────────────────────

router.post('/:id/skus', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const { sku_name, face_value, cost_price, buy_discount_bps } = req.body;
  if (!sku_name || face_value === undefined) {
    res.status(400).json({ error: 'sku_name, face_value required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO product_skus (product_id, sku_name, face_value, cost_price, buy_discount_bps)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [req.params.id, sku_name, face_value, cost_price ?? null, buy_discount_bps ?? 0],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/products/:id/skus/:skuId ──────────────────────────────────────

router.patch('/:id/skus/:skuId', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed = ['sku_name', 'face_value', 'cost_price', 'buy_discount_bps', 'is_active'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
  const values = [req.params.skuId, req.params.id, ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE product_skus SET ${sets}, updated_at = NOW()
       WHERE sku_id = $1 AND product_id = $2
       RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'SKU not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
