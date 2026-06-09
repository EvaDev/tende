// src/merchants.routes.js
// Merchant management for the server UI.
//
// Public:
//   GET  /api/merchants           — list active merchants (consumer UI merchant discovery)
//   GET  /api/merchants/:id       — single merchant (consumer UI checkout)
//
// Admin:
//   POST  /api/merchants                        — register a new merchant
//   PATCH /api/merchants/:id                    — update merchant details
//   PATCH /api/merchants/:id/verification       — set verification status
//   POST  /api/merchants/:id/offramp            — add off-ramp config
//   PATCH /api/merchants/:id/offramp/:configId  — update off-ramp config

import express, { Request, Response } from 'express';
import db      from './db.js';
import { requireAdmin }  from './admin.middleware.js';

const router = express.Router();

// ── GET /api/merchants ────────────────────────────────────────────────────────

router.get('/', async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  try {
    const country = req.query.country as string | undefined;
  const status  = req.query.status  as string | undefined;
    const conditions = ['m.is_active = TRUE'];
    const values     = [];

    if (country) {
      values.push(country.toUpperCase());
      conditions.push(`m.country_code = $${values.length}`);
    }
    if (status) {
      values.push(status.toUpperCase());
      conditions.push(`m.verification_status = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT
         m.merchant_id, m.name, m.country_code, m.currency_code,
         m.wallet_address, m.verification_status,
         m.primary1_color, m.primary2_color, m.logo_arweave_id,
         m.website, m.settlement_currency, m.created_at
       FROM merchants m
       ${where}
       ORDER BY m.name`,
      values,
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/merchants/:id ────────────────────────────────────────────────────

router.get('/:id', async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  try {
    const result = await db.query(
      `SELECT m.*,
         json_agg(o.*) FILTER (WHERE o.config_id IS NOT NULL) AS offramp_configs
       FROM merchants m
       LEFT JOIN merchant_offramp_config o ON o.merchant_id = m.merchant_id AND o.is_active = TRUE
       WHERE m.merchant_id = $1
       GROUP BY m.merchant_id`,
      [req.params.id],
    );
    if (!result.rows.length) res.status(404).json({ error: 'Merchant not found' });

    // Strip sensitive bank fields for non-admin callers
    const merchant = result.rows[0];
    if (merchant.offramp_configs) {
      merchant.offramp_configs = merchant.offramp_configs.map((c: Record<string, unknown>) => ({
        ...c,
        bank_account_number: (c.bank_account_number as string | null) ? '••••' + (c.bank_account_number as string).slice(-4) : null,
        bank_branch_code:    c.bank_branch_code    ? '••••' : null,
      }));
    }
    res.json(merchant);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/merchants ───────────────────────────────────────────────────────

router.post('/', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const {
    name, country_code, currency_code, wallet_address,
    primary1_color, primary2_color, logo_arweave_id,
    email, website, settlement_currency,
  } = req.body;

  if (!name || !country_code || !currency_code) {
    res.status(400).json({ error: 'name, country_code, currency_code required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO merchants
         (name, country_code, currency_code, wallet_address,
          primary1_color, primary2_color, logo_arweave_id,
          email, website, settlement_currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        name, country_code.toUpperCase(), currency_code.toUpperCase(),
        wallet_address?.toLowerCase() ?? null,
        primary1_color ?? null, primary2_color ?? null, logo_arweave_id ?? null,
        email ?? null, website ?? null, settlement_currency ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === '23505') res.status(409).json({ error: 'Wallet address already registered' });
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/merchants/:id ──────────────────────────────────────────────────

router.patch('/:id', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed = [
    'name', 'wallet_address', 'primary1_color', 'primary2_color',
    'logo_arweave_id', 'email', 'website', 'settlement_currency', 'is_active',
  ];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [req.params.id, ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE merchants SET ${sets}, updated_at = NOW() WHERE merchant_id = $1 RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'Merchant not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/merchants/:id/verification ─────────────────────────────────────

router.patch('/:id/verification', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const { status, kyc_level_id } = req.body;
  const valid = ['PENDING', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'REJECTED'];
  if (!status || !valid.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  }
  try {
    const result = await db.query(
      `UPDATE merchants
       SET verification_status = $2, kyc_level_id = $3, updated_at = NOW()
       WHERE merchant_id = $1
       RETURNING merchant_id, name, verification_status, kyc_level_id`,
      [req.params.id, status, kyc_level_id ?? null],
    );
    if (!result.rows.length) res.status(404).json({ error: 'Merchant not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/merchants/:id/offramp ───────────────────────────────────────────

router.post('/:id/offramp', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const {
    offramp_type, bank_name, bank_account_number, bank_branch_code,
    bank_account_type, account_holder_name, crypto_wallet_address, crypto_network,
    preferred_settlement_currency, min_settlement_amount, auto_settle,
  } = req.body;

  if (!offramp_type) {
    res.status(400).json({ error: 'offramp_type required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO merchant_offramp_config
         (merchant_id, offramp_type, bank_name, bank_account_number, bank_branch_code,
          bank_account_type, account_holder_name, crypto_wallet_address, crypto_network,
          preferred_settlement_currency, min_settlement_amount, auto_settle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.params.id, offramp_type,
        bank_name ?? null, bank_account_number ?? null, bank_branch_code ?? null,
        bank_account_type ?? null, account_holder_name ?? null,
        crypto_wallet_address ?? null, crypto_network ?? null,
        preferred_settlement_currency ?? null, min_settlement_amount ?? null,
        auto_settle ?? false,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/merchants/:id/offramp/:configId ────────────────────────────────

router.patch('/:id/offramp/:configId', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed = [
    'bank_name', 'bank_account_number', 'bank_branch_code', 'bank_account_type',
    'account_holder_name', 'crypto_wallet_address', 'preferred_settlement_currency',
    'min_settlement_amount', 'auto_settle', 'is_active',
  ];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(', ');
  const values = [req.params.configId, req.params.id, ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE merchant_offramp_config
       SET ${sets}, updated_at = NOW()
       WHERE config_id = $1 AND merchant_id = $2
       RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'Off-ramp config not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
