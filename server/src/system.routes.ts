// src/system.routes.js
// System config reference data: countries, currencies, stablecoins, KYC levels.
//
// Public reads (no auth):
//   GET /api/system/countries
//   GET /api/system/currencies
//   GET /api/system/stablecoins
//   GET /api/system/kyc-levels/:countryCode
//
// Admin writes (requireAdmin):
//   POST   /api/system/countries
//   PATCH  /api/system/countries/:code
//   POST   /api/system/currencies
//   PATCH  /api/system/currencies/:code
//   POST   /api/system/stablecoins
//   PATCH  /api/system/stablecoins/:code
//   POST   /api/system/kyc-levels
//   PATCH  /api/system/kyc-levels/:id

import express, { Request, Response } from 'express';
import db      from './db.js';
import { requireAdmin } from './admin.middleware.js';

const router = express.Router();

// ── Countries ─────────────────────────────────────────────────────────────────

router.get('/countries', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, cu.currency_symbol
       FROM countries c
       JOIN currencies cu ON cu.currency_code = c.currency_code
       ORDER BY c.name`,
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/countries', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const { country_code, name, currency_code, vat_rate_pct, dial_code } = req.body;
  if (!country_code || !name || !currency_code) {
    res.status(400).json({ error: 'country_code, name, currency_code required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO countries (country_code, name, currency_code, vat_rate_pct, dial_code)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [country_code.toUpperCase(), name, currency_code, vat_rate_pct ?? 0, dial_code ?? null],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === '23505') res.status(409).json({ error: 'Country code already exists' });
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/countries/:code', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed  = ['name', 'vat_rate_pct', 'dial_code', 'is_active'];
  const updates  = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [(req.params.code as string).toUpperCase(), ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE countries SET ${sets}, updated_at = NOW() WHERE country_code = $1 RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'Country not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Currencies ────────────────────────────────────────────────────────────────

router.get('/currencies', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM currencies ORDER BY currency_type, currency_code`,
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/currencies', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const { currency_code, name, currency_symbol, decimals, base_currency_code, currency_type } = req.body;
  if (!currency_code || !name || !currency_type) {
    res.status(400).json({ error: 'currency_code, name, currency_type required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO currencies (currency_code, name, currency_symbol, decimals, base_currency_code, currency_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [currency_code.toUpperCase(), name, currency_symbol ?? null, decimals ?? 2, base_currency_code ?? null, currency_type],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === '23505') res.status(409).json({ error: 'Currency code already exists' });
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/currencies/:code', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed = ['name', 'currency_symbol', 'decimals', 'is_active'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [(req.params.code as string).toUpperCase(), ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE currencies SET ${sets}, updated_at = NOW() WHERE currency_code = $1 RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'Currency not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Stablecoins ───────────────────────────────────────────────────────────────

router.get('/stablecoins', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, cu.name AS currency_name, cu.decimals, cu.base_currency_code
       FROM stablecoins s
       JOIN currencies cu ON cu.currency_code = s.currency_code
       ORDER BY s.internal_code`,
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/stablecoins', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const { internal_code, currency_code, contract_address, is_primary, is_treasury_token } = req.body;
  if (!internal_code || !currency_code) {
    res.status(400).json({ error: 'internal_code, currency_code required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO stablecoins (internal_code, currency_code, contract_address, is_primary, is_treasury_token)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [internal_code.toUpperCase(), currency_code, contract_address ?? null, is_primary ?? false, is_treasury_token ?? false],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === '23505') res.status(409).json({ error: 'Stablecoin already exists' });
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/stablecoins/:code', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed = ['contract_address', 'is_primary', 'is_deployed', 'is_active', 'total_supply'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [(req.params.code as string).toUpperCase(), ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE stablecoins SET ${sets}, updated_at = NOW() WHERE internal_code = $1 RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'Stablecoin not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── KYC levels ────────────────────────────────────────────────────────────────

router.get('/kyc-levels/:countryCode', async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  try {
    const result = await db.query(
      `SELECT * FROM kyc_levels WHERE country_code = $1 ORDER BY level_id`,
      [(req.params.countryCode as string).toUpperCase()],
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/kyc-levels', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const {
    country_code, level_name,
    max_single_tx, max_daily_spend, max_monthly_spend, max_wallet_balance, max_daily_send,
    requires_id_doc, requires_biometric, allows_usd_savings, allows_remittance,
    allows_merchant_spend, idos_credential_required,
  } = req.body;

  if (!country_code || !level_name) {
    res.status(400).json({ error: 'country_code, level_name required' });
  }
  try {
    const result = await db.query(
      `INSERT INTO kyc_levels
         (country_code, level_name,
          max_single_tx, max_daily_spend, max_monthly_spend, max_wallet_balance, max_daily_send,
          requires_id_doc, requires_biometric, allows_usd_savings, allows_remittance,
          allows_merchant_spend, idos_credential_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        country_code.toUpperCase(), level_name,
        max_single_tx ?? null, max_daily_spend ?? null, max_monthly_spend ?? null,
        max_wallet_balance ?? null, max_daily_send ?? null,
        requires_id_doc ?? false, requires_biometric ?? false,
        allows_usd_savings ?? false, allows_remittance ?? false,
        allows_merchant_spend ?? true, idos_credential_required ?? false,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === '23505') res.status(409).json({ error: 'KYC level name already exists for this country' });
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/kyc-levels/:id', requireAdmin, async (req: import('express').Request, res: import('express').Response): Promise<void> => {
  const allowed = [
    'level_name', 'max_single_tx', 'max_daily_spend', 'max_monthly_spend',
    'max_wallet_balance', 'max_daily_send', 'requires_id_doc', 'requires_biometric',
    'allows_usd_savings', 'allows_remittance', 'allows_merchant_spend', 'idos_credential_required',
  ];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: `Updatable fields: ${allowed.join(', ')}` });
  }
  const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [parseInt(req.params.id as string), ...Object.values(updates)];
  try {
    const result = await db.query(
      `UPDATE kyc_levels SET ${sets}, updated_at = NOW() WHERE level_id = $1 RETURNING *`,
      values,
    );
    if (!result.rows.length) res.status(404).json({ error: 'KYC level not found' });
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
