// src/settlement.routes.ts
// Merchant org settlement (payout) requests — the "head-office approval gate"
// half of the hybrid custody model (project_merchant_org_model memory).
// Any operator can request a payout; requests at/below the org's threshold are
// auto-executed, above it they sit 'pending' until a DIFFERENT org_admin
// approves. Execution calls Vault.withdrawToExternal (backend-signed,
// ADMIN_EXECUTOR_ROLE) — no merchant private key needed on-chain either way.

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import config from './config.js';
import db from './db.js';
import { requireMemberAuth, requireOrgAdmin } from './memberAuth.middleware.js';
import { withdrawToExternal } from './treasuryService.js';

const router = express.Router();

interface SettlementConfig { threshold_amount: string; threshold_currency: string | null; require_approval: boolean }
interface SettlementRequestRow {
  id: number; merchant_id: string; requested_by: number; amount: string; currency: string;
  destination: string; status: string; approved_by: number | null; approved_at: Date | null;
  executed_tx_hash: string | null; created_at: Date;
}

async function getConfig(merchantId: string): Promise<SettlementConfig> {
  const r = await db.query<SettlementConfig>(
    `SELECT threshold_amount, threshold_currency, require_approval FROM merchant_settlement_config WHERE merchant_id = $1`,
    [merchantId],
  );
  return r.rows[0] ?? { threshold_amount: '0', threshold_currency: null, require_approval: true };
}

// `currency` here is a FIAT code (e.g. 'ZAR', settlement_currency) — resolve it
// to the on-chain token pegged to it via currencies.base_currency_code (e.g.
// ZAR -> TTZA). stablecoins.currency_code is the TOKEN's own code (TTZA), not
// the fiat it's pegged to, so a direct match on the fiat code always misses —
// this was the earlier bug. If `currency` is itself already a token code
// (e.g. someone settles straight in USDC), match that directly too.
async function tokenAddressForCurrency(currency: string): Promise<string> {
  const code = currency.toUpperCase();
  const r = await db.query<{ contract_address: string }>(
    `SELECT s.contract_address FROM stablecoins s
     JOIN currencies c ON c.currency_code = s.currency_code
     WHERE s.is_deployed AND s.contract_address IS NOT NULL
       AND (c.base_currency_code = $1 OR s.currency_code = $1)
     ORDER BY s.is_primary DESC, c.currency_type = 'TREASURY' DESC
     LIMIT 1`,
    [code],
  );
  if (!r.rows.length) throw new Error(`No deployed token pegged to currency ${currency}`);
  return r.rows[0].contract_address;
}

// currencies.decimals in the DB has drifted from on-chain truth before (see
// project_admin_ui_state — TTZA was recorded as 6 when the real decimals() is
// 2), so read the token's own decimals() rather than trust the DB.
const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)'];
async function onchainDecimals(tokenAddress: string): Promise<number> {
  const c = new ethers.Contract(tokenAddress, ERC20_DECIMALS_ABI, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  return Number(await c.decimals());
}

async function executeSettlement(req: SettlementRequestRow): Promise<void> {
  const merchantRes = await db.query<{ wallet_address: string }>(
    `SELECT wallet_address FROM merchants WHERE merchant_id = $1`, [req.merchant_id]);
  const fromWallet = merchantRes.rows[0]?.wallet_address;
  if (!fromWallet) throw new Error('Merchant has no wallet on file');

  const token = await tokenAddressForCurrency(req.currency);
  const decimals = await onchainDecimals(token);
  // Pilot: no bank off-ramp yet, so `destination` is an on-chain recipient address.
  const amountUnits = ethers.parseUnits(req.amount, decimals);
  const txHash = await withdrawToExternal(fromWallet, req.destination, token, amountUnits);
  await db.query(
    `UPDATE settlement_requests SET status = 'executed', executed_tx_hash = $1 WHERE id = $2`,
    [txHash, req.id],
  );
}

// ── POST /api/settlement/config ────────────────────────────────────────────── (org_admin)
router.post('/config', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  const { thresholdAmount, thresholdCurrency, requireApproval } = req.body as Record<string, unknown>;
  await db.query(
    `INSERT INTO merchant_settlement_config (merchant_id, threshold_amount, threshold_currency, require_approval)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (merchant_id) DO UPDATE SET
       threshold_amount = EXCLUDED.threshold_amount,
       threshold_currency = EXCLUDED.threshold_currency,
       require_approval = EXCLUDED.require_approval`,
    [req.member!.merchantId, thresholdAmount ?? 0, thresholdCurrency ?? null, requireApproval ?? true],
  );
  res.json(await getConfig(req.member!.merchantId));
});

router.get('/config', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  res.json(await getConfig(req.member!.merchantId));
});

// ── GET /api/settlement/requests ───────────────────────────────────────────── (any member)
router.get('/requests', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  const r = await db.query<SettlementRequestRow>(
    `SELECT * FROM settlement_requests WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [req.member!.merchantId],
  );
  res.json(r.rows);
});

// ── POST /api/settlement/requests ─────────────────────────────────────────── (any member)
router.post('/requests', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, currency, destination } = req.body as Record<string, string>;
    if (!amount || !currency || !destination) {
      res.status(400).json({ error: 'amount, currency, destination required' }); return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) {
      res.status(400).json({ error: 'destination must be a 0x address (no off-ramp rail wired yet)' }); return;
    }

    const cfg = await getConfig(req.member!.merchantId);
    const overThreshold = cfg.require_approval && Number(amount) > Number(cfg.threshold_amount);

    const ins = await db.query<SettlementRequestRow>(
      `INSERT INTO settlement_requests (merchant_id, requested_by, amount, currency, destination, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.member!.merchantId, req.member!.memberId, amount, currency.toUpperCase(), destination,
       overThreshold ? 'pending' : 'approved'],
    );
    let request = ins.rows[0];

    if (!overThreshold) {
      try {
        await executeSettlement(request);
        const r = await db.query<SettlementRequestRow>(`SELECT * FROM settlement_requests WHERE id = $1`, [request.id]);
        request = r.rows[0];
      } catch (e) {
        await db.query(`UPDATE settlement_requests SET status = 'failed' WHERE id = $1`, [request.id]);
        res.status(502).json({ error: 'Execution failed', detail: (e as Error).message, request: { ...request, status: 'failed' } });
        return;
      }
    }

    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/settlement/requests/:id/approve ─────────────────────────────── (org_admin, not the requester)
router.post('/requests/:id/approve', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query<SettlementRequestRow>(
      `SELECT * FROM settlement_requests WHERE id = $1 AND merchant_id = $2`,
      [Number(req.params.id), req.member!.merchantId],
    );
    const request = r.rows[0];
    if (!request) { res.status(404).json({ error: 'Not found' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ error: `Request is ${request.status}, not pending` }); return; }
    if (request.requested_by === req.member!.memberId) {
      res.status(403).json({ error: 'A different head-office admin must approve this request' }); return;
    }

    await db.query(
      `UPDATE settlement_requests SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2`,
      [req.member!.memberId, request.id],
    );
    request.status = 'approved'; request.approved_by = req.member!.memberId;

    try {
      await executeSettlement(request);
    } catch (e) {
      await db.query(`UPDATE settlement_requests SET status = 'failed' WHERE id = $1`, [request.id]);
      res.status(502).json({ error: 'Execution failed', detail: (e as Error).message }); return;
    }

    const final = await db.query<SettlementRequestRow>(`SELECT * FROM settlement_requests WHERE id = $1`, [request.id]);
    res.json(final.rows[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/settlement/requests/:id/reject ──────────────────────────────── (org_admin)
router.post('/requests/:id/reject', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  const r = await db.query<SettlementRequestRow>(
    `UPDATE settlement_requests SET status = 'rejected', approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND merchant_id = $3 AND status = 'pending' RETURNING *`,
    [req.member!.memberId, Number(req.params.id), req.member!.merchantId],
  );
  if (!r.rows.length) { res.status(409).json({ error: 'Not found or not pending' }); return; }
  res.json(r.rows[0]);
});

export default router;
