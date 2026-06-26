// src/reports.routes.ts
// Admin reporting over the indexed chain_events (mounted at /api/admin/reports).
// The indexer is the data source (chain = truth); these endpoints are read-only
// projections for ops / compliance / revenue reporting.

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import db from './db.js';
import { requireAdmin } from './admin.middleware.js';

const router = express.Router();

// Vault currency codes are emitted as indexed bytes32 (keccak256 of the symbol),
// so chain_events stores the hash. Map known hashes back to readable symbols.
const CURRENCY_BY_HASH: Record<string, string> = {};
for (const code of ['ZAR', 'USDC', 'USD', 'ZWL', 'MWK', 'ZARP', 'ZARU']) {
  CURRENCY_BY_HASH[ethers.id(code).toLowerCase()] = code;
}
const decodeCurrency = (hash: unknown): string => {
  const h = String(hash ?? '').toLowerCase();
  return CURRENCY_BY_HASH[h] ?? h;
};

// GET /api/admin/reports/summary — counts by contract/event + indexer cursor.
router.get('/summary', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const total  = await db.query(`SELECT count(*)::int n, MIN(block_number) minb, MAX(block_number) maxb FROM chain_events`);
    const byType = await db.query(`SELECT contract, event_name, count(*)::int n FROM chain_events GROUP BY contract, event_name ORDER BY contract, event_name`);
    const cursor = await db.query(`SELECT last_block, updated_at FROM indexer_cursor WHERE id = 1`);
    res.json({
      totalEvents: total.rows[0].n,
      blockRange:  [total.rows[0].minb, total.rows[0].maxb],
      cursor:      cursor.rows[0] ?? null,
      byType:      byType.rows,
    });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/events?contract=&event=&address=&fromBlock=&toBlock=&limit=&offset=
router.get('/events', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const where: string[] = []; const vals: (string | number)[] = [];
  if (req.query.contract) { vals.push(String(req.query.contract));            where.push(`contract = $${vals.length}`); }
  if (req.query.event)    { vals.push(String(req.query.event));               where.push(`event_name = $${vals.length}`); }
  if (req.query.address)  { vals.push(String(req.query.address).toLowerCase()); where.push(`(address = $${vals.length} OR args->>'from' = $${vals.length} OR args->>'to' = $${vals.length})`); }
  if (req.query.fromBlock){ vals.push(Number(req.query.fromBlock));            where.push(`block_number >= $${vals.length}`); }
  if (req.query.toBlock)  { vals.push(Number(req.query.toBlock));              where.push(`block_number <= $${vals.length}`); }
  const limit  = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  vals.push(limit);  const lp = vals.length;
  vals.push(offset); const op = vals.length;
  try {
    const r = await db.query(
      `SELECT block_number, block_time, contract, event_name, tx_hash, log_index, args
       FROM chain_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY block_number DESC, log_index DESC LIMIT $${lp} OFFSET $${op}`,
      vals);
    res.json({ count: r.rows.length, limit, offset, events: r.rows });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/transfers — value movements (the flow / Travel-Rule feed).
router.get('/transfers', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT block_number, block_time, tx_hash,
              args->>'from' AS "from", args->>'to' AS "to",
              args->>'amount' AS amount, args->>'currencyCode' AS currency_hash
       FROM chain_events WHERE event_name = 'Transferred'
       ORDER BY block_number DESC LIMIT 500`);
    res.json(r.rows.map(x => ({ ...x, currency: decodeCurrency(x.currency_hash) })));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/revenue — protocol revenue = sum of harvested platform cut.
router.get('/revenue', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT args->>'currencyCode' AS currency_hash,
              SUM((args->>'platformCut')::numeric)::text AS platform_cut,
              count(*)::int AS harvests
       FROM chain_events WHERE event_name = 'YieldHarvested'
       GROUP BY args->>'currencyCode'`);
    res.json(r.rows.map(x => ({ currency: decodeCurrency(x.currency_hash), platformCut: x.platform_cut, harvests: x.harvests })));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

export default router;
