// src/config.routes.ts
// GET  /api/config        — public: returns brand + app name for UI bootstrap
// GET  /api/config/all    — admin: returns all keys
// PATCH /api/config/:key  — admin: update a value

import express, { Request, Response } from 'express';
import db from './db.js';
import { requireAdmin } from './admin.middleware.js';
import ensService from './ensService.js';

const router = express.Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const result = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM app_config WHERE key LIKE 'app.%' OR key LIKE 'brand.%'`
  );
  const config: Record<string, string> = {};
  for (const row of result.rows) config[row.key] = row.value;
  // ENS parent domain is sourced from env (single source of truth), not the DB
  config['ens.parent_domain'] = ensService.parentDomain;
  res.json(config);
});

router.get('/registration-fields', async (_req: Request, res: Response): Promise<void> => {
  const result = await db.query(
    `SELECT field_key, label, included, required, verification_method
     FROM registration_fields ORDER BY sort_order`,
  );
  res.json(result.rows);
});

router.get('/all', async (_req: Request, res: Response): Promise<void> => {
  const result = await db.query<{ key: string; value: string; description: string }>(
    `SELECT key, value, description FROM app_config ORDER BY key`
  );
  res.json(result.rows);
});

router.patch('/:key', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { key } = req.params;
  const { value } = req.body as { value?: string };
  if (!value) { res.status(400).json({ error: 'value required' }); return; }
  const result = await db.query(
    `UPDATE app_config SET value=$1, updated_at=NOW() WHERE key=$2 RETURNING key, value`,
    [value, key]
  );
  if (result.rowCount === 0) { res.status(404).json({ error: 'key not found' }); return; }
  res.json(result.rows[0]);
});

export default router;
