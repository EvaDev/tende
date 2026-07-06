// Aggregated platform health metrics — vault ledger by user segment.
// Treasury-backed balances (e.g. ZAR/TTZA) are claims against the platform (TVL).
// Non-treasury balances (e.g. USDC) are held directly by users — not platform claims.

import { ethers } from 'ethers';
import db from './db.js';
import config from './config.js';
import fxService from './fxService.js';
import { unifiedBalanceOf } from './safeRelayService.js';

const CURRENCY_BY_HASH: Record<string, string> = {};
for (const code of ['ZAR', 'USDC', 'USD', 'ZWL', 'MWK', 'ZARP', 'ZARU', 'TTZA']) {
  CURRENCY_BY_HASH[ethers.id(code).toLowerCase()] = code;
}
const decodeCurrency = (hash: unknown): string => {
  const h = String(hash ?? '').toLowerCase();
  return CURRENCY_BY_HASH[h] ?? h;
};

const DECIMALS: Record<string, number> = { USDC: 6, USD: 6 };
const decimalsFor = (currency: string): number => DECIMALS[currency] ?? 2;

const toMajor = (raw: number, decimals: number): string =>
  (raw / 10 ** decimals).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });

export interface SegmentBalance {
  currency: string;
  token: string | null;
  amount: string;
  amountValue: number;
}

export interface SegmentMetrics {
  tvl: SegmentBalance[];
  held: SegmentBalance[];
}

export interface VaultClaims {
  consumers: SegmentMetrics;
  merchants: SegmentMetrics;
  totalHeld: SegmentBalance[];
  pendingSettlements: { count: number; totalZar: string };
}

export interface TreasuryDashboardSummary {
  /** Combined TTZA supply + vault USDC (ZAR equivalent), integer */
  totalTreasuryDisplay: string;
  /** TTZA total supply, e.g. "R311" */
  ttzaOutstandingDisplay: string;
  /** Non-treasury backing assets in vault, e.g. "$901" */
  vaultUsdcDisplay: string;
  /** TTZA held by platform (supply − user vault claims − burned), e.g. "R205" */
  platformTtzaDisplay: string;
  /** @deprecated */
  vaultReserveDisplay: string;
  /** @deprecated */
  investablesUsdDisplay: string;
  /** @deprecated */
  treasurySupplyDisplay: string;
}

const fmtIntZar = (n: number) => `R${Math.round(n).toLocaleString()}`;
const fmtIntUsd = (n: number) => `$${Math.round(n).toLocaleString()}`;

const ERC20_ABI = ['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];
const VAULT_USDC_ABI = ['function usdcToken() view returns (address)'];

async function sumOnChainZar(wallets: string[]): Promise<number> {
  let total = 0;
  for (const w of wallets) {
    try {
      const raw = await unifiedBalanceOf(w, 'ZAR');
      total += Number(raw) / 10 ** decimalsFor('ZAR');
    } catch { /* skip */ }
  }
  return total;
}

export async function getTreasuryDashboardSummary(): Promise<TreasuryDashboardSummary> {
  const vaultAddr = config.contracts.vault;
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const erc20 = (addr: string) => new ethers.Contract(addr, ERC20_ABI, provider);

  const supplyParts: string[] = [];
  let ttzaOutstanding = 0;
  try {
    const q = await db.query<{ code: string; address: string; decimals: number }>(
      `SELECT s.internal_code AS code, s.contract_address AS address, cu.decimals
         FROM stablecoins s JOIN currencies cu ON cu.currency_code = s.internal_code
        WHERE s.is_treasury_token = TRUE AND s.is_deployed = TRUE AND s.contract_address IS NOT NULL
        ORDER BY s.internal_code`,
    );
    for (const r of q.rows) {
      try {
        const c = erc20(r.address);
        const raw = await c.totalSupply() as bigint;
        const dec = Number(await c.decimals());
        const major = Number(raw) / 10 ** dec;
        if (r.code === 'TTZA') ttzaOutstanding = major;
        supplyParts.push(`${fmtIntZar(major)} ${r.code}`);
      } catch { /* skip */ }
    }
  } catch { /* registry absent */ }
  if (supplyParts.length === 0 && config.contracts.treasuryTokenZA) {
    try {
      const c = erc20(config.contracts.treasuryTokenZA);
      const raw = await c.totalSupply() as bigint;
      ttzaOutstanding = Number(raw) / 100;
      supplyParts.push(`${fmtIntZar(ttzaOutstanding)} TTZA`);
    } catch { /* skip */ }
  }

  let investablesUsd = 0;
  if (vaultAddr) {
    try {
      const vault = new ethers.Contract(vaultAddr, VAULT_USDC_ABI, provider);
      const usdc = await vault.usdcToken() as string;
      if (usdc && !/^0x0+$/.test(usdc)) {
        const raw = await erc20(usdc).balanceOf(vaultAddr) as bigint;
        investablesUsd = Number(raw) / 1e6;
      }
    } catch { /* skip */ }
  }

  const vaultUsdcDisplay = fmtIntUsd(investablesUsd);
  const ttzaOutstandingDisplay = fmtIntZar(ttzaOutstanding);

  const [consumerWallets, merchantWallets] = await Promise.all([
    db.query<{ wallet_address: string }>(`SELECT wallet_address FROM consumers WHERE wallet_address IS NOT NULL`),
    db.query<{ wallet_address: string }>(`SELECT wallet_address FROM merchants WHERE wallet_address IS NOT NULL`),
  ]);
  const userClaimsZar = (await sumOnChainZar(consumerWallets.rows.map(r => r.wallet_address)))
    + (await sumOnChainZar(merchantWallets.rows.map(r => r.wallet_address)));
  const platformTtza = Math.max(0, ttzaOutstanding - userClaimsZar);

  let usdcZar = 0;
  try {
    const quote = await fxService.getRate('ZAR', 'USD');
    if (quote.rate && quote.rate > 0) usdcZar = investablesUsd / quote.rate;
  } catch { /* FX unavailable */ }
  const totalTreasuryDisplay = fmtIntZar(ttzaOutstanding + usdcZar);

  return {
    totalTreasuryDisplay,
    ttzaOutstandingDisplay,
    vaultUsdcDisplay,
    platformTtzaDisplay: fmtIntZar(platformTtza),
    vaultReserveDisplay: totalTreasuryDisplay,
    investablesUsdDisplay: vaultUsdcDisplay,
    treasurySupplyDisplay: supplyParts.length ? supplyParts.join(' · ') : '—',
  };
}

async function sumOnChainUsdcHeld(wallets: string[]): Promise<number> {
  let total = 0;
  for (const w of wallets) {
    try {
      const raw = await unifiedBalanceOf(w, 'USDC');
      total += Number(raw) / 1e6;
    } catch { /* skip */ }
  }
  return total;
}

function mergeBalances(rows: SegmentBalance[]): SegmentBalance[] {
  const byKey = new Map<string, SegmentBalance>();
  for (const r of rows) {
    const key = `${r.currency}|${r.token ?? ''}`;
    const prev = byKey.get(key);
    const dec = decimalsFor(r.currency);
    if (prev) {
      const sum = prev.amountValue + r.amountValue;
      byKey.set(key, { ...prev, amountValue: sum, amount: toMajor(Math.round(sum * 10 ** dec), dec) });
    } else {
      byKey.set(key, { ...r });
    }
  }
  return [...byKey.values()].sort((a, b) => b.amountValue - a.amountValue);
}

export async function getVaultClaimsBySegment(): Promise<VaultClaims> {
  const cur = await db.query<{ currency_code: string; currency_type: string; base_currency_code: string | null }>(
    `SELECT currency_code, currency_type, base_currency_code FROM currencies`);
  const meta = new Map<string, { type: string; base: string | null }>();
  const tokenFor = new Map<string, string>();
  for (const r of cur.rows) {
    meta.set(r.currency_code, { type: r.currency_type, base: r.base_currency_code });
    if ((r.currency_type === 'TREASURY' || r.currency_type === 'STABLECOIN') && r.base_currency_code) {
      if (!tokenFor.has(r.base_currency_code) || r.currency_type === 'TREASURY') {
        tokenFor.set(r.base_currency_code, r.currency_code);
      }
    }
  }
  const fiatAndToken = (symbol: string): { fiat: string; token: string | null } => {
    const m = meta.get(symbol);
    if (!m) return { fiat: symbol, token: null };
    if (m.type === 'FIAT') return { fiat: symbol, token: tokenFor.get(symbol) ?? null };
    return { fiat: m.base ?? symbol, token: symbol };
  };
  const isTvlClaim = (symbol: string): boolean => {
    const m = meta.get(symbol);
    if (!m) return false;
    if (m.type === 'TREASURY') return true;
    if (m.type === 'FIAT') return tokenFor.has(symbol);
    return false;
  };

  const r = await db.query<{ seg: string; currency_hash: string; net_minor: string }>(
    `WITH segments AS (
       SELECT LOWER(wallet_address) AS w, 'merchant' AS seg FROM merchants WHERE wallet_address IS NOT NULL
       UNION ALL
       SELECT LOWER(wallet_address), 'consumer' FROM consumers WHERE wallet_address IS NOT NULL
     ),
     ledger AS (
       SELECT LOWER(args->>'user') AS w, args->>'currencyCode' AS ch,
              SUM(CASE WHEN event_name='Credited' THEN (args->>'amount')::numeric
                       WHEN event_name='Debited'  THEN -(args->>'amount')::numeric ELSE 0 END) AS net_minor
         FROM chain_events
        WHERE event_name IN ('Credited','Debited')
        GROUP BY 1, 2
     )
     SELECT s.seg, l.ch AS currency_hash, SUM(l.net_minor)::text AS net_minor
       FROM ledger l
       JOIN segments s ON l.w = s.w
      GROUP BY s.seg, l.ch
      HAVING SUM(l.net_minor) <> 0`,
  );

  const bySeg: Record<string, { tvl: SegmentBalance[]; held: SegmentBalance[] }> = {
    consumer: { tvl: [], held: [] },
    merchant: { tvl: [], held: [] },
  };
  for (const row of r.rows) {
    const symbol = decodeCurrency(row.currency_hash);
    const dec = decimalsFor(symbol);
    const netRaw = Number(row.net_minor);
    if (netRaw <= 0) continue;
    const { fiat, token } = fiatAndToken(symbol);
    const entry: SegmentBalance = {
      currency: fiat,
      token,
      amount: toMajor(netRaw, dec),
      amountValue: netRaw / 10 ** dec,
    };
    const key = row.seg === 'merchant' ? 'merchant' : 'consumer';
    if (isTvlClaim(symbol)) bySeg[key].tvl.push(entry);
    else bySeg[key].held.push(entry);
  }

  const consumers = { tvl: mergeBalances(bySeg.consumer.tvl), held: mergeBalances(bySeg.consumer.held) };
  let merchantsTvl = mergeBalances(bySeg.merchant.tvl);

  const [consumerWallets, merchantWalletsList] = await Promise.all([
    db.query<{ wallet_address: string }>(`SELECT wallet_address FROM consumers WHERE wallet_address IS NOT NULL`),
    db.query<{ wallet_address: string }>(`SELECT wallet_address FROM merchants WHERE wallet_address IS NOT NULL`),
  ]);

  // Consumer TVL: on-chain vault balance is authoritative; ledger misses P2P Transferred.
  let consumerZarOnChain = await sumOnChainZar(consumerWallets.rows.map(r => r.wallet_address));
  if (consumerZarOnChain > 0 || consumers.tvl.length > 0) {
    const dec = decimalsFor('ZAR');
    consumers.tvl = [{
      currency: 'ZAR',
      token: tokenFor.get('ZAR') ?? 'TTZA',
      amount: toMajor(Math.round(consumerZarOnChain * 10 ** dec), dec),
      amountValue: consumerZarOnChain,
    }];
  }

  // Merchant TVL: on-chain vault balance is authoritative; fall back to ledger +
  // open settlement requests when the chain read is unavailable.
  let onChainZar = await sumOnChainZar(merchantWalletsList.rows.map(r => r.wallet_address));
  const pendingZar = Number((await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM settlement_requests
     WHERE status IN ('pending','approved') AND currency = 'ZAR'`,
  )).rows[0]?.total ?? 0);
  const ledgerZar = merchantsTvl.find(x => x.currency === 'ZAR')?.amountValue ?? 0;
  const zarTvl = Math.max(onChainZar, ledgerZar + pendingZar);
  if (zarTvl > 0) {
    const dec = decimalsFor('ZAR');
    merchantsTvl = [{
      currency: 'ZAR',
      token: tokenFor.get('ZAR') ?? 'TTZA',
      amount: toMajor(Math.round(zarTvl * 10 ** dec), dec),
      amountValue: zarTvl,
    }];
  }

  const merchants = { tvl: merchantsTvl, held: mergeBalances(bySeg.merchant.held) };
  let totalHeld = mergeBalances([...bySeg.consumer.held, ...bySeg.merchant.held]);

  // USDC held: ledger Credited/Debited misses harvest (price-per-share lift). Use on-chain balances.
  const allWallets = [
    ...consumerWallets.rows.map(r => r.wallet_address),
    ...merchantWalletsList.rows.map(r => r.wallet_address),
  ];
  const onChainUsdc = await sumOnChainUsdcHeld(allWallets);
  if (onChainUsdc > 0) {
    totalHeld = totalHeld.filter(x => x.currency !== 'USD' && x.token !== 'USDC');
    totalHeld.push({
      currency: 'USD',
      token: 'USDC',
      amount: toMajor(Math.round(onChainUsdc * 1e6), 6),
      amountValue: onChainUsdc,
    });
    totalHeld.sort((a, b) => b.amountValue - a.amountValue);
  }

  // Refresh consumer/merchant held USDC from chain for segment tiles
  const consumerUsdc = await sumOnChainUsdcHeld(consumerWallets.rows.map(r => r.wallet_address));
  if (consumerUsdc > 0) {
    consumers.held = consumers.held.filter(x => x.currency !== 'USD' && x.token !== 'USDC');
    consumers.held.push({
      currency: 'USD',
      token: 'USDC',
      amount: toMajor(Math.round(consumerUsdc * 1e6), 6),
      amountValue: consumerUsdc,
    });
  }

  const pending = await db.query<{ count: string; total: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(amount), 0)::text AS total
       FROM settlement_requests WHERE status IN ('pending','approved','failed') AND currency = 'ZAR'`,
  );

  return {
    consumers,
    merchants,
    totalHeld,
    pendingSettlements: {
      count: Number(pending.rows[0]?.count ?? 0),
      totalZar: Number(pending.rows[0]?.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
    },
  };
}
