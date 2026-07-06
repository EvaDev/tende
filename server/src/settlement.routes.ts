// src/settlement.routes.ts
// Merchant org settlement (payout) requests — the "head-office approval gate"
// half of the hybrid custody model (project_merchant_org_model memory).
// Any operator can request a payout; requests at/below the org's threshold are
// auto-executed for ONCHAIN merchants, above they sit 'pending' until a DIFFERENT
// org_admin approves. FIAT settlement requests always wait for platform operator
// execution after internal approval — tokens move to the platform treasury and
// are burned once fiat is paid out to the merchant's bank.

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import config from './config.js';
import db from './db.js';
import { requireMemberAuth, requireOrgAdmin } from './memberAuth.middleware.js';
import { unifiedBalanceOf } from './safeRelayService.js';
import { withdrawToExternal, vaultBackingTokenForCurrency, vaultAdminDebit, sweepTreasuryFromVault } from './treasuryService.js';
import { getRevenueConfig, calcSettlementFee } from './revenueConfig.js';
import { recordGasFromTxHash } from './gasCostService.js';

const router = express.Router();

interface SettlementConfig { threshold_amount: string; threshold_currency: string | null; require_approval: boolean }
interface SettlementRequestRow {
  id: number; merchant_id: string; requested_by: number; amount: string; currency: string;
  destination: string; status: string; approved_by: number | null; approved_at: Date | null;
  executed_tx_hash: string | null; created_at: Date;
  fee_bps: number | null; fee_amount: string | null; net_amount: string | null;
}

const DECIMALS: Record<string, number> = { USDC: 6, USD: 6 };
const decimalsFor = (c: string): number => DECIMALS[c.toUpperCase()] ?? 2;

async function getConfig(merchantId: string): Promise<SettlementConfig> {
  const r = await db.query<SettlementConfig>(
    `SELECT threshold_amount, threshold_currency, require_approval FROM merchant_settlement_config WHERE merchant_id = $1`,
    [merchantId],
  );
  return r.rows[0] ?? { threshold_amount: '0', threshold_currency: null, require_approval: true };
}

async function getMerchantMeta(merchantId: string): Promise<{ wallet_address: string | null; settlement_type: string; settlement_currency: string | null }> {
  const r = await db.query<{ wallet_address: string | null; settlement_type: string; settlement_currency: string | null }>(
    `SELECT wallet_address, settlement_type, settlement_currency FROM merchants WHERE merchant_id = $1`, [merchantId]);
  return r.rows[0] ?? { wallet_address: null, settlement_type: 'FIAT', settlement_currency: 'ZAR' };
}

async function tokenAddressForCurrency(currency: string): Promise<string> {
  return vaultBackingTokenForCurrency(currency);
}

async function executeSettlement(req: SettlementRequestRow, settlementType: string): Promise<void> {
  const merchantRes = await db.query<{ wallet_address: string; country_code: string }>(
    `SELECT wallet_address, country_code FROM merchants WHERE merchant_id = $1`, [req.merchant_id]);
  const fromWallet = merchantRes.rows[0]?.wallet_address;
  const countryCode = merchantRes.rows[0]?.country_code ?? 'ZA';
  if (!fromWallet) throw new Error('Merchant has no wallet on file');

  const currency = req.currency.toUpperCase();
  // Vault ledger amounts use currency minor units (2dp ZAR, 6dp USDC) — same as
  // consumer transfers and adminCredit. Do not use the backing ERC-20 decimals
  // here; Sepolia mock ZARP may be 18dp while the ledger is always 2dp for ZAR.
  const amountUnits = ethers.parseUnits(req.amount, decimalsFor(currency));

  const balance = await unifiedBalanceOf(fromWallet, currency);
  if (balance < amountUnits) {
    throw new Error(
      `Insufficient vault balance: have ${ethers.formatUnits(balance, decimalsFor(currency))} ${currency}, need ${req.amount}`,
    );
  }

  const toAddress = settlementType === 'FIAT'
    ? (config.platform.treasuryAddress ?? '')
    : req.destination;
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    throw new Error('Platform treasury address not configured for fiat settlement');
  }

  const revenue = await getRevenueConfig();
  const feeBps = req.fee_bps ?? revenue.settlementFeeBps;
  const { fee, net } = calcSettlementFee(Number(req.amount), feeBps);

  let txHash: string;
  if (settlementType === 'FIAT') {
    // POC fiat rail: debit unified claim, sweep TTZA reserve to platform treasury.
    const debitTx = await vaultAdminDebit(fromWallet, amountUnits, currency);
    await recordGasFromTxHash(debitTx, 'settlement_debit');
    txHash = await sweepTreasuryFromVault(toAddress, amountUnits, countryCode);
    await recordGasFromTxHash(txHash, 'settlement_sweep');
  } else {
    const token = await tokenAddressForCurrency(currency);
    txHash = await withdrawToExternal(fromWallet, toAddress, token, amountUnits);
    await recordGasFromTxHash(txHash, 'settlement');
  }

  await db.query(
    `UPDATE settlement_requests
        SET status = 'executed', executed_tx_hash = $1, fee_bps = $2, fee_amount = $3, net_amount = $4
      WHERE id = $5`,
    [txHash, feeBps, fee, net, req.id],
  );
}

async function bankPayoutLabel(merchantId: string): Promise<string | null> {
  const r = await db.query<{ bank_name: string | null; bank_account_number: string | null }>(
    `SELECT bank_name, bank_account_number FROM merchant_offramp_config
     WHERE merchant_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
    [merchantId],
  );
  const row = r.rows[0];
  if (!row?.bank_account_number) return null;
  const last4 = row.bank_account_number.slice(-4);
  return row.bank_name ? `${row.bank_name} ···${last4}` : `···${last4}`;
}

// ── GET /api/settlement/balance ──────────────────────────────────────────────
router.get('/balance', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = req.member!.merchantId;
    const meta = await getMerchantMeta(merchantId);
    if (!meta.wallet_address) {
      res.json({ currency: meta.settlement_currency ?? 'ZAR', vaultBalance: '0.00', pendingSettlement: '0.00', available: '0.00', settlementType: meta.settlement_type, bankPayout: null });
      return;
    }

    const currency = (meta.settlement_currency ?? 'ZAR').toUpperCase();
    const raw = await unifiedBalanceOf(meta.wallet_address, currency);
    const dec = decimalsFor(currency);
    const vaultValue = Number(raw) / 10 ** dec;

    const pending = await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM settlement_requests
       WHERE merchant_id = $1 AND status IN ('pending','approved','failed') AND currency = $2`,
      [merchantId, currency],
    );
    const pendingValue = Number(pending.rows[0]?.total ?? 0);
    const available = Math.max(0, vaultValue - pendingValue);

    res.json({
      currency,
      vaultBalance: vaultValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: dec }),
      pendingSettlement: pendingValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: dec }),
      available: available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: dec }),
      settlementType: meta.settlement_type,
      bankPayout: meta.settlement_type === 'FIAT' ? await bankPayoutLabel(merchantId) : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

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
  const revenue = await getRevenueConfig();
  res.json({ ...(await getConfig(req.member!.merchantId)), settlementFeeBps: revenue.settlementFeeBps });
});

// ── GET /api/settlement/requests ─────────────────────────────────────────────
router.get('/requests', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  const r = await db.query<SettlementRequestRow>(
    `SELECT * FROM settlement_requests WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [req.member!.merchantId],
  );
  res.json(r.rows);
});

// ── POST /api/settlement/requests ───────────────────────────────────────────
router.post('/requests', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, currency, destination, bankReference } = req.body as Record<string, string>;
    if (!amount || !currency) {
      res.status(400).json({ error: 'amount and currency required' }); return;
    }

    const meta = await getMerchantMeta(req.member!.merchantId);
    const isFiat = meta.settlement_type !== 'ONCHAIN';

    let dest = destination?.trim() ?? '';
    if (isFiat) {
      dest = bankReference?.trim() || dest || (await bankPayoutLabel(req.member!.merchantId)) || 'Bank payout (see off-ramp config)';
    } else if (!/^0x[0-9a-fA-F]{40}$/.test(dest)) {
      res.status(400).json({ error: 'destination must be a 0x address for on-chain settlement' }); return;
    }

    const revenue = await getRevenueConfig();
    const gross = Number(amount);
    const { fee, net } = calcSettlementFee(gross, revenue.settlementFeeBps);
    const isOrgAdmin = req.member!.role === 'org_admin';
    // POC: head-office requests are approved immediately (no second approver).
    const status = isOrgAdmin ? 'approved' : 'pending';

    const ins = await db.query<SettlementRequestRow>(
      `INSERT INTO settlement_requests
         (merchant_id, requested_by, amount, currency, destination, status,
          approved_by, approved_at, fee_bps, fee_amount, net_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [req.member!.merchantId, req.member!.memberId, amount, currency.toUpperCase(), dest, status,
       isOrgAdmin ? req.member!.memberId : null, isOrgAdmin ? new Date() : null,
       revenue.settlementFeeBps, fee, net],
    );
    let request = ins.rows[0];

    // ONCHAIN only: auto-execute when approved. FIAT waits for platform operator.
    if (status === 'approved' && !isFiat) {
      try {
        await executeSettlement(request, 'ONCHAIN');
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

// ── POST /api/settlement/requests/:id/approve ───────────────────────────────
router.post('/requests/:id/approve', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query<SettlementRequestRow>(
      `SELECT * FROM settlement_requests WHERE id = $1 AND merchant_id = $2`,
      [Number(req.params.id), req.member!.merchantId],
    );
    const request = r.rows[0];
    if (!request) { res.status(404).json({ error: 'Not found' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ error: `Request is ${request.status}, not pending` }); return; }
    await db.query(
      `UPDATE settlement_requests SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2`,
      [req.member!.memberId, request.id],
    );
    request.status = 'approved'; request.approved_by = req.member!.memberId;

    const meta = await getMerchantMeta(req.member!.merchantId);
    if (meta.settlement_type === 'ONCHAIN') {
      try {
        await executeSettlement(request, 'ONCHAIN');
      } catch (e) {
        await db.query(`UPDATE settlement_requests SET status = 'failed' WHERE id = $1`, [request.id]);
        res.status(502).json({ error: 'Execution failed', detail: (e as Error).message }); return;
      }
    }

    const final = await db.query<SettlementRequestRow>(`SELECT * FROM settlement_requests WHERE id = $1`, [request.id]);
    res.json(final.rows[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/requests/:id/reject', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  const r = await db.query<SettlementRequestRow>(
    `UPDATE settlement_requests SET status = 'rejected', approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND merchant_id = $3 AND status = 'pending' RETURNING *`,
    [req.member!.memberId, Number(req.params.id), req.member!.merchantId],
  );
  if (!r.rows.length) { res.status(409).json({ error: 'Not found or not pending' }); return; }
  res.json(r.rows[0]);
});

export type { SettlementRequestRow };
export { executeSettlement, getMerchantMeta };
export default router;
