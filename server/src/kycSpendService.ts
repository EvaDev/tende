// kycSpendService.ts — server-side KYC send limits from DB accumulators.
// Limits live on kyc_levels (2-decimal fiat minor units, ZAR-cent style).
// USDC amounts are converted to ZAR-equivalent minor units via FX for comparison.

import { ethers } from 'ethers';
import db from './db.js';
import fxService from './fxService.js';
import { currencyDecimals } from './currencyHelper.js';

export type SpendType = 'p2p' | 'purchase' | 'withdrawal' | 'escrow' | 'remittance';

export interface KycLimits {
  levelName: string;
  maxSingleTx: bigint | null;   // limit units (2dp fiat minor)
  maxDailySend: bigint | null;
  maxMonthlySpend: bigint | null;
}

export interface SpendCheckOk {
  ok: true;
  limits: KycLimits;
  spentToday: bigint;
  spentMonth: bigint;
  amountLimitUnits: bigint;
}

export interface SpendCheckFail {
  ok: false;
  code: 'KYC_SINGLE_EXCEEDED' | 'KYC_DAILY_EXCEEDED' | 'KYC_MONTHLY_EXCEEDED' | 'KYC_LEVEL_MISSING';
  error: string;
  limits?: KycLimits;
}

/** Convert vault amount units → KYC limit units (2dp ZAR-equivalent minor). */
export async function toLimitUnits(amountUnits: bigint, currency: string): Promise<bigint> {
  const code = currency.toUpperCase();
  const dec = currencyDecimals(code);
  // Already 2dp fiat (ZAR, MWK, …)
  if (dec === 2 && code !== 'USDC' && code !== 'USD') return amountUnits;

  const major = Number(ethers.formatUnits(amountUnits, dec));
  if (!Number.isFinite(major) || major <= 0) return 0n;

  if (code === 'USDC' || code === 'USD') {
    const quote = await fxService.getRate('USD', 'ZAR');
    const zarPerUsd = quote.rate && quote.rate > 0 ? quote.rate : 18; // pilot fallback
    return BigInt(Math.round(major * zarPerUsd * 100));
  }

  // Other 6dp → treat major as ZAR for pilot
  return BigInt(Math.round(major * 100));
}

export async function getConsumerKycLimits(consumerId: string): Promise<KycLimits | null> {
  const r = await db.query<{
    level_name: string;
    max_single_tx: string | null;
    max_daily_send: string | null;
    max_monthly_spend: string | null;
  }>(
    `SELECT k.level_name, k.max_single_tx::text, k.max_daily_send::text, k.max_monthly_spend::text
       FROM consumers c
       JOIN kyc_levels k ON k.level_id = c.kyc_level_id
      WHERE c.consumer_id = $1`,
    [consumerId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const n = (v: string | null) => (v == null || v === '' ? null : BigInt(v.split('.')[0]));
  return {
    levelName: row.level_name,
    maxSingleTx: n(row.max_single_tx),
    maxDailySend: n(row.max_daily_send),
    maxMonthlySpend: n(row.max_monthly_spend),
  };
}

async function sumSpent(
  walletAddress: string,
  since: Date,
  types?: SpendType[],
): Promise<bigint> {
  const params: unknown[] = [walletAddress.toLowerCase(), since.toISOString()];
  let typeClause = '';
  if (types?.length) {
    params.push(types);
    typeClause = ` AND spend_type = ANY($${params.length}::text[])`;
  }
  const r = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount_limit_units), 0)::text AS total
       FROM consumer_spend_events
      WHERE LOWER(wallet_address) = $1
        AND created_at >= $2::timestamptz
        ${typeClause}`,
    params,
  );
  return BigInt(r.rows[0]?.total?.split('.')[0] ?? '0');
}

export async function assertKycSendAllowed(params: {
  consumerId: string;
  walletAddress: string;
  amountUnits: bigint;
  currency: string;
  spendType: SpendType;
}): Promise<SpendCheckOk | SpendCheckFail> {
  const limits = await getConsumerKycLimits(params.consumerId);
  if (!limits) {
    return { ok: false, code: 'KYC_LEVEL_MISSING', error: 'KYC level not configured for this account' };
  }

  const amountLimitUnits = await toLimitUnits(params.amountUnits, params.currency);

  if (limits.maxSingleTx != null && amountLimitUnits > limits.maxSingleTx) {
    return {
      ok: false,
      code: 'KYC_SINGLE_EXCEEDED',
      error: `Amount exceeds your ${limits.levelName} single-transaction limit`,
      limits,
    };
  }

  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [spentToday, spentMonth] = await Promise.all([
    sumSpent(params.walletAddress, startOfDay),
    sumSpent(params.walletAddress, startOfMonth),
  ]);

  if (limits.maxDailySend != null && spentToday + amountLimitUnits > limits.maxDailySend) {
    return {
      ok: false,
      code: 'KYC_DAILY_EXCEEDED',
      error: `Amount would exceed your ${limits.levelName} daily send limit`,
      limits,
    };
  }
  if (limits.maxMonthlySpend != null && spentMonth + amountLimitUnits > limits.maxMonthlySpend) {
    return {
      ok: false,
      code: 'KYC_MONTHLY_EXCEEDED',
      error: `Amount would exceed your ${limits.levelName} monthly spend limit`,
      limits,
    };
  }

  return { ok: true, limits, spentToday, spentMonth, amountLimitUnits };
}

export async function recordSpendEvent(params: {
  consumerId: string;
  walletAddress: string;
  spendType: SpendType;
  currency: string;
  amountUnits: bigint;
  amountLimitUnits?: bigint;
  counterparty?: string;
  txHash?: string;
}): Promise<void> {
  const limitUnits = params.amountLimitUnits
    ?? await toLimitUnits(params.amountUnits, params.currency);
  await db.query(
    `INSERT INTO consumer_spend_events
       (consumer_id, wallet_address, spend_type, currency, amount_units, amount_limit_units, counterparty, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.consumerId,
      params.walletAddress.toLowerCase(),
      params.spendType,
      params.currency.toUpperCase(),
      params.amountUnits.toString(),
      limitUnits.toString(),
      params.counterparty?.toLowerCase() ?? null,
      params.txHash ?? null,
    ],
  ).catch(e => console.error('[recordSpendEvent] non-fatal:', (e as Error).message));
}
