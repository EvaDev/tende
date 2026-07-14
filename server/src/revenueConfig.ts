// Platform revenue fee rates — stored in app_config, editable from Admin Settings.

import db from './db.js';

export interface RevenueConfig {
  fxSpreadBps: number;
  settlementFeeBps: number;
  withdrawalFeeBps: number;
}

const DEFAULTS: RevenueConfig = { fxSpreadBps: 150, settlementFeeBps: 150, withdrawalFeeBps: 150 };

let cache: { cfg: RevenueConfig; expiresAt: number } | null = null;
const TTL_MS = 30_000;

function parseBps(raw: string | undefined, fallback: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function getRevenueConfig(): Promise<RevenueConfig> {
  if (cache && cache.expiresAt > Date.now()) return cache.cfg;
  try {
    const r = await db.query<{ key: string; value: string }>(
      `SELECT key, value FROM app_config WHERE key IN (
         'revenue.fx_spread_bps', 'revenue.settlement_fee_bps', 'revenue.withdrawal_fee_bps'
       )`,
    );
    const map = Object.fromEntries(r.rows.map(row => [row.key, row.value]));
    const cfg: RevenueConfig = {
      fxSpreadBps:       parseBps(map['revenue.fx_spread_bps'],      DEFAULTS.fxSpreadBps),
      settlementFeeBps:  parseBps(map['revenue.settlement_fee_bps'], DEFAULTS.settlementFeeBps),
      withdrawalFeeBps:  parseBps(map['revenue.withdrawal_fee_bps'], DEFAULTS.withdrawalFeeBps),
    };
    cache = { cfg, expiresAt: Date.now() + TTL_MS };
    return cfg;
  } catch {
    return DEFAULTS;
  }
}

export function invalidateRevenueConfigCache(): void {
  cache = null;
}

export function calcSettlementFee(gross: number, feeBps: number): { fee: number; net: number } {
  const fee = Math.round(gross * feeBps) / 10_000;
  return { fee: Math.round(fee * 100) / 100, net: Math.round((gross - fee) * 100) / 100 };
}

/** Fee on integer token units (e.g. USDC 6dp). Rounds fee up in favour of the platform. */
export function calcWithdrawalFeeUnits(grossUnits: bigint, feeBps: number): { feeUnits: bigint; netUnits: bigint } {
  if (feeBps <= 0) return { feeUnits: 0n, netUnits: grossUnits };
  const feeUnits = (grossUnits * BigInt(feeBps) + 9999n) / 10000n;
  if (feeUnits >= grossUnits) {
    throw new Error('Withdrawal fee would consume the entire amount');
  }
  return { feeUnits, netUnits: grossUnits - feeUnits };
}
