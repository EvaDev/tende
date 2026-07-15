// Tracks ETH gas paid by the platform backend signer (relayer wallet).

import { ethers } from 'ethers';
import config from './config.js';
import db from './db.js';
import dexQuoteService from './dexQuoteService.js';
import fxService from './fxService.js';

export type GasCategory = 'onboarding' | 'transaction' | 'operations' | 'deployment';

export const GAS_CATEGORY_LABELS: Record<GasCategory, string> = {
  onboarding:  'Customer acquisition (onboarding)',
  transaction: 'Consumer transactions (relay)',
  operations:  'Platform operations',
  deployment:  'Contract deployments',
};

/** Human-readable labels for protocol_gas_costs.source. */
export const GAS_SOURCE_LABELS: Record<string, string> = {
  passkey: 'passkey',
  relay: 'passkey', // legacy — same as passkey Safe exec
  session: 'session',
  session_ok: 'session (successful)',
  session_fail: 'session (unsuccessful)',
  session_enable: 'session enable',
  session_add_key: 'session add key',
  session_revoke: 'session revoke',
  conversion: 'conversion',
  settlement: 'settlement',
  cash_in: 'cash in',
  register_deploy: 'register deploy',
  register_signer: 'register signer',
};

/** Category-table labels for consumer/relay gas (splits the former single "relay" bucket). */
export const CONSUMER_TX_CATEGORY_LABELS: Record<string, string> = {
  passkey: 'Passkey payments',
  relay: 'Passkey payments',
  session: 'Session payments',
  session_ok: 'Session payments (successful)',
  session_fail: 'Session payments (unsuccessful)',
  session_enable: 'Session enable module',
  session_add_key: 'Session add key',
  session_revoke: 'Session revoke',
};

export function labelForGasSource(source: string): string {
  return GAS_SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

export function labelForConsumerTxCategory(source: string): string {
  return CONSUMER_TX_CATEGORY_LABELS[source] ?? `Consumer: ${labelForGasSource(source)}`;
}

/** Map a granular source tag to a reporting category. */
export function categoryForSource(source: string): GasCategory {
  if (source.startsWith('register_')) return 'onboarding';
  if (
    source === 'relay'
    || source === 'passkey'
    || source === 'session'
    || source === 'session_ok'
    || source === 'session_fail'
    || source.startsWith('session_')
  ) return 'transaction';
  if (source.startsWith('contract_') || source === 'deploy' || source === 'upgrade') return 'deployment';
  return 'operations';
}

export function backendSignerAddress(): string {
  return new ethers.Wallet(config.backend.privateKey).address;
}

/** Owner/deployer wallet — pays UUPS deploys and upgrades (not the backend relayer). */
export function deployerAdminAddress(): string {
  const raw = process.env['DEPLOYER_ADMIN_ADDRESS'] ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return '';
  return ethers.getAddress(raw);
}

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

const SAFE_EXEC_SEL = '0x6a761202';
const SEL = {
  executeTransfer: ethers.id('executeTransfer(address,address,address,uint256,bytes32,uint256,bytes)').slice(0, 10).toLowerCase(),
  addSessionKey: ethers.id('addSessionKey(address,uint64,uint256,uint256)').slice(0, 10).toLowerCase(),
  removeSessionKey: ethers.id('removeSessionKey(address)').slice(0, 10).toLowerCase(),
  enableModule: ethers.id('enableModule(address)').slice(0, 10).toLowerCase(),
};

const SAFE_EXEC_IFACE = new ethers.Interface([
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)',
]);

/** Decode a backend relay tx into a granular gas source tag. */
export async function inferConsumerRelaySource(txHash: string): Promise<string> {
  try {
    const tx = await provider().getTransaction(txHash);
    if (!tx?.data) return 'passkey';
    const top = tx.data.slice(0, 10).toLowerCase();
    if (top === SEL.executeTransfer) return 'session';
    if (top !== SAFE_EXEC_SEL) return 'passkey';
    try {
      const parsed = SAFE_EXEC_IFACE.parseTransaction({ data: tx.data });
      const inner = String(parsed?.args?.data ?? '0x');
      const innerSel = inner.length >= 10 ? inner.slice(0, 10).toLowerCase() : '';
      if (innerSel === SEL.enableModule) return 'session_enable';
      if (innerSel === SEL.addSessionKey) return 'session_add_key';
      if (innerSel === SEL.removeSessionKey) return 'session_revoke';
    } catch { /* fall through */ }
    return 'passkey';
  } catch {
    return 'passkey';
  }
}

/** Re-label legacy `relay` rows by decoding calldata (idempotent). */
async function reclassifyLegacyRelaySources(): Promise<void> {
  try {
    const rows = await db.query<{ tx_hash: string }>(
      `SELECT tx_hash FROM protocol_gas_costs WHERE source = 'relay'`,
    );
    for (const row of rows.rows) {
      const source = await inferConsumerRelaySource(row.tx_hash);
      await db.query(
        `UPDATE protocol_gas_costs SET source = $2, category = $3 WHERE tx_hash = $1`,
        [row.tx_hash, source, categoryForSource(source)],
      );
    }
  } catch { /* table may not exist */ }
}

export async function recordGasFromReceipt(
  receipt: ethers.TransactionReceipt,
  source: string,
  category?: GasCategory,
  opts?: { expectedPayer?: string },
): Promise<void> {
  if (!receipt?.hash) return;
  const cat = category ?? categoryForSource(source);
  const expected = (opts?.expectedPayer ?? backendSignerAddress()).toLowerCase();
  if (receipt.from.toLowerCase() !== expected) return;
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.gasPrice ?? 0n;
  const costWei = gasUsed * gasPrice;
  try {
    await db.query(
      `INSERT INTO protocol_gas_costs (tx_hash, source, category, gas_used, gas_price_wei, cost_wei, block_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tx_hash) DO UPDATE SET
         source = EXCLUDED.source,
         category = EXCLUDED.category`,
      [
        receipt.hash,
        source,
        cat,
        gasUsed.toString(),
        gasPrice.toString(),
        costWei.toString(),
        receipt.blockNumber,
      ],
    );
  } catch {
    // Table may not exist yet on older DBs — ignore.
  }
}

export async function recordGasFromTxHash(
  hash: string,
  source: string,
  category?: GasCategory,
): Promise<void> {
  try {
    const receipt = await provider().getTransactionReceipt(hash);
    if (receipt && receipt.from.toLowerCase() === backendSignerAddress().toLowerCase()) {
      await recordGasFromReceipt(receipt, source, category);
    }
  } catch { /* ignore */ }
}

/** Infer source/category from known platform tx tables (backfill). */
export async function classifyTxHash(txHash: string): Promise<{ source: string; category: GasCategory }> {
  const h = txHash.toLowerCase();
  const rules: { sql: string; source: string; category: GasCategory }[] = [
    {
      sql: `SELECT 1 FROM registration_attempts WHERE tx_hash IS NOT NULL AND LOWER(tx_hash) = $1 LIMIT 1`,
      source: 'register_deploy',
      category: 'onboarding',
    },
    {
      sql: `SELECT 1 FROM merchant_sales WHERE tx_hash IS NOT NULL AND LOWER(tx_hash) = $1 LIMIT 1`,
      source: 'passkey',
      category: 'transaction',
    },
    {
      sql: `SELECT 1 FROM settlement_requests WHERE executed_tx_hash IS NOT NULL AND LOWER(executed_tx_hash) = $1 LIMIT 1`,
      source: 'settlement',
      category: 'operations',
    },
    {
      sql: `SELECT 1 FROM consumer_conversions
            WHERE LOWER(debit_tx) = $1 OR LOWER(credit_tx) = $1 LIMIT 1`,
      source: 'conversion',
      category: 'operations',
    },
    {
      sql: `SELECT 1 FROM deposit_references
            WHERE LOWER(mint_tx) = $1 OR LOWER(credit_tx) = $1 LIMIT 1`,
      source: 'cash_in',
      category: 'operations',
    },
  ];
  for (const rule of rules) {
    try {
      const r = await db.query(rule.sql, [h]);
      if (r.rows.length) return { source: rule.source, category: rule.category };
    } catch { /* table may not exist */ }
  }
  return { source: 'operations', category: 'operations' };
}

async function collectKnownTxHashes(): Promise<string[]> {
  const r = await db.query<{ h: string }>(
    `SELECT tx_hash AS h FROM merchant_sales WHERE tx_hash IS NOT NULL
     UNION SELECT executed_tx_hash FROM settlement_requests WHERE executed_tx_hash IS NOT NULL
     UNION SELECT tx_hash FROM registration_attempts WHERE tx_hash IS NOT NULL
     UNION SELECT debit_tx FROM consumer_conversions WHERE debit_tx IS NOT NULL
     UNION SELECT credit_tx FROM consumer_conversions WHERE credit_tx IS NOT NULL
     UNION SELECT mint_tx FROM deposit_references WHERE mint_tx IS NOT NULL
     UNION SELECT credit_tx FROM deposit_references WHERE credit_tx IS NOT NULL`,
  );
  return r.rows.map(x => x.h).filter(Boolean);
}

async function collectDeploymentTxHashes(): Promise<{ hash: string; source: string }[]> {
  const out: { hash: string; source: string }[] = [];
  try {
    const r = await db.query<{ tx_hash: string; contract_name: string; tx_kind: string }>(
      `SELECT tx_hash, contract_name, tx_kind FROM contract_deployment_txs`,
    );
    for (const row of r.rows) {
      out.push({ hash: row.tx_hash, source: `contract_${row.tx_kind}:${row.contract_name}` });
    }
  } catch { /* table may not exist */ }
  try {
    const r = await db.query<{ deploy_tx: string; contract_name: string }>(
      `SELECT deploy_tx, contract_name FROM contract_deployments WHERE deploy_tx IS NOT NULL`,
    );
    for (const row of r.rows) {
      out.push({ hash: row.deploy_tx, source: `contract_deploy:${row.contract_name}` });
    }
  } catch { /* skip */ }
  return out;
}

/** Index gas for contract deploy/upgrade txs paid by the deployer admin wallet. */
export async function ensureDeploymentGasIndexed(): Promise<void> {
  const deployer = deployerAdminAddress();
  if (!deployer) return;
  try {
    const known = await collectDeploymentTxHashes();
    if (!known.length) return;
    const existing = await db.query<{ tx_hash: string }>(`SELECT tx_hash FROM protocol_gas_costs`);
    const have = new Set(existing.rows.map(x => x.tx_hash.toLowerCase()));
    const p = provider();
    for (const { hash, source } of known) {
      if (have.has(hash.toLowerCase())) continue;
      const receipt = await p.getTransactionReceipt(hash);
      if (!receipt) continue;
      await recordGasFromReceipt(receipt, source, 'deployment', { expectedPayer: deployer });
    }
  } catch { /* tables may not exist */ }
}

/** Index gas for known backend txs not yet recorded (idempotent). */
export async function ensureGasCostsIndexed(): Promise<void> {
  await ensureDeploymentGasIndexed();
  await reclassifyLegacyRelaySources();
  try {
    const known = await collectKnownTxHashes();
    if (!known.length) return;
    const existing = await db.query<{ tx_hash: string }>(`SELECT tx_hash FROM protocol_gas_costs`);
    const have = new Set(existing.rows.map(x => x.tx_hash.toLowerCase()));
    const backend = backendSignerAddress().toLowerCase();
    const p = provider();

    for (const hash of known) {
      if (have.has(hash.toLowerCase())) continue;
      const receipt = await p.getTransactionReceipt(hash);
      if (!receipt || receipt.from.toLowerCase() !== backend) continue;
      let { source, category } = await classifyTxHash(hash);
      if (source === 'passkey' || source === 'relay') {
        source = await inferConsumerRelaySource(hash);
        category = categoryForSource(source);
      }
      await recordGasFromReceipt(receipt, source, category);
    }
  } catch {
    // protocol_gas_costs table may not exist yet.
  }
}

export interface GasFeeTotals {
  totalWei: string;
  totalEth: number;
  totalZar: number;
  ethUsd: number | null;
  usdPerZar: number | null;
  transactionCount: number;
  byCategory: {
    category: GasCategory;
    source?: string;
    label: string;
    count: number;
    totalEth: number;
    totalZar: number;
    zarPerTx: number;
    lastZar: number;
  }[];
  /** High-level groups (consumer / onboarding / operations / deployment) with detail rows. */
  byGroup: {
    group: GasCategory;
    label: string;
    count: number;
    totalEth: number;
    totalZar: number;
    zarPerTx: number;
    lastZar: number;
    rows: {
      category: GasCategory;
      source?: string;
      label: string;
      count: number;
      totalEth: number;
      totalZar: number;
      zarPerTx: number;
      lastZar: number;
    }[];
  }[];
  bySource: {
    source: string;
    label: string;
    category: GasCategory;
    count: number;
    totalEth: number;
    totalZar: number;
    zarPerTx: number;
    lastZar: number;
  }[];
  recent: {
    txHash: string;
    source: string;
    label: string;
    category: GasCategory;
    gasUsed: number;
    costEth: number;
    costZar: number;
    blockNumber: number | null;
    recordedAt: string;
  }[];
}

const WETH_MAINNET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

async function ethZarRate(): Promise<{ ethUsd: number | null; usdPerZar: number | null }> {
  const [ethQuote, zarUsd] = await Promise.all([
    dexQuoteService.getPriceUsd({ contract_address: WETH_MAINNET, decimals: 18, pool_fee_tier: 500 }),
    fxService.getRate('ZAR', 'USD'),
  ]);
  return { ethUsd: ethQuote.priceUsd, usdPerZar: zarUsd.rate };
}

function ethToZar(eth: number, ethUsd: number | null, usdPerZar: number | null): number {
  if (!eth || ethUsd == null || usdPerZar == null || usdPerZar <= 0) return 0;
  return (eth * ethUsd) / usdPerZar;
}

function zarPerTx(totalZar: number, count: number): number {
  return count > 0 ? totalZar / count : 0;
}

type CostRow = { cost_wei: string; recorded_at: Date | string };

function aggregateCosts(
  rows: CostRow[],
  ethUsd: number | null,
  usdPerZar: number | null,
): { count: number; totalEth: number; totalZar: number; zarPerTx: number; lastZar: number } {
  let totalWei = 0n;
  let latestAt = -1;
  let latestWei = 0n;
  for (const r of rows) {
    const wei = BigInt(r.cost_wei);
    totalWei += wei;
    const at = new Date(r.recorded_at).getTime();
    if (at >= latestAt) {
      latestAt = at;
      latestWei = wei;
    }
  }
  const totalEth = Number(totalWei) / 1e18;
  const totalZar = ethToZar(totalEth, ethUsd, usdPerZar);
  const lastEth = latestAt >= 0 ? Number(latestWei) / 1e18 : 0;
  return {
    count: rows.length,
    totalEth,
    totalZar,
    zarPerTx: zarPerTx(totalZar, rows.length),
    lastZar: latestAt >= 0 ? ethToZar(lastEth, ethUsd, usdPerZar) : 0,
  };
}

/** Session pays that ended in fulfilment failure / refund vs everything else. */
function isUnsuccessfulSessionPayment(saleStatus: string | null, fulfilmentStatus: string | null): boolean {
  return saleStatus === 'refunded' || fulfilmentStatus === 'failed';
}

const GROUP_ORDER: GasCategory[] = ['transaction', 'onboarding', 'operations', 'deployment'];

const GROUP_LABELS: Record<GasCategory, string> = {
  transaction: 'Consumer transactions',
  onboarding: 'Customer acquisition',
  operations: 'Platform operations',
  deployment: 'Contract deployments',
};

export async function getGasFeeTotals(): Promise<GasFeeTotals> {
  await ensureGasCostsIndexed();
  const empty: GasFeeTotals = {
    totalWei: '0', totalEth: 0, totalZar: 0, ethUsd: null, usdPerZar: null,
    transactionCount: 0, byCategory: [], byGroup: [], bySource: [], recent: [],
  };
  try {
    const [total, gasRows, recent, rates] = await Promise.all([
      db.query<{ wei: string; n: string }>(
        `SELECT COALESCE(SUM(cost_wei), 0)::text AS wei, COUNT(*)::text AS n FROM protocol_gas_costs`,
      ),
      db.query<{
        tx_hash: string; source: string; category: GasCategory; cost_wei: string; recorded_at: Date;
        sale_status: string | null; fulfilment_status: string | null;
      }>(
        `SELECT g.tx_hash, g.source, g.category, g.cost_wei::text, g.recorded_at,
                s.status AS sale_status, s.fulfilment_status
           FROM protocol_gas_costs g
           LEFT JOIN merchant_sales s ON LOWER(s.tx_hash) = LOWER(g.tx_hash)
          ORDER BY g.recorded_at DESC`,
      ),
      db.query<{
        tx_hash: string; source: string; category: GasCategory; gas_used: string; cost_wei: string;
        block_number: string | null; recorded_at: string;
      }>(
        `SELECT tx_hash, source, category, gas_used::text, cost_wei::text, block_number::text, recorded_at
           FROM protocol_gas_costs ORDER BY recorded_at DESC LIMIT 50`,
      ),
      ethZarRate(),
    ]);

    const { ethUsd, usdPerZar } = rates;
    const totalWei = total.rows[0]?.wei ?? '0';
    const totalEth = Number(totalWei) / 1e18;

    // Classify rows (session → ok/fail) then bucket by report source.
    type Bucket = { category: GasCategory; source: string; rows: CostRow[] };
    const buckets = new Map<string, Bucket>();
    const bucketKey = (category: GasCategory, source: string) => `${category}::${source}`;

    for (const r of gasRows.rows) {
      let source = r.source;
      if (source === 'session' || source === 'session_ok' || source === 'session_fail') {
        source = isUnsuccessfulSessionPayment(r.sale_status, r.fulfilment_status)
          ? 'session_fail'
          : 'session_ok';
      } else if (source === 'relay') {
        source = 'passkey';
      }
      const key = bucketKey(r.category, source);
      const b = buckets.get(key) ?? { category: r.category, source, rows: [] };
      b.rows.push({ cost_wei: r.cost_wei, recorded_at: r.recorded_at });
      buckets.set(key, b);
    }

    const consumerRows: GasFeeTotals['byCategory'] = [];
    const rolled = new Map<GasCategory, CostRow[]>();

    for (const b of buckets.values()) {
      if (b.category === 'transaction') {
        // Session payments are emitted as successful/unsuccessful below.
        if (b.source === 'session' || b.source === 'session_ok' || b.source === 'session_fail') continue;
        const m = aggregateCosts(b.rows, ethUsd, usdPerZar);
        consumerRows.push({
          category: 'transaction',
          source: b.source,
          label: labelForConsumerTxCategory(b.source),
          ...m,
        });
      } else {
        const cur = rolled.get(b.category) ?? [];
        cur.push(...b.rows);
        rolled.set(b.category, cur);
      }
    }

    // Always show both session outcome lines when any session payment exists.
    if (buckets.has(bucketKey('transaction', 'session_ok'))
      || buckets.has(bucketKey('transaction', 'session_fail'))) {
      for (const source of ['session_ok', 'session_fail'] as const) {
        const rows = buckets.get(bucketKey('transaction', source))?.rows ?? [];
        const m = aggregateCosts(rows, ethUsd, usdPerZar);
        consumerRows.push({
          category: 'transaction',
          source,
          label: labelForConsumerTxCategory(source),
          ...m,
        });
      }
    }

    consumerRows.sort((a, b) => {
      const aS = a.source === 'session_ok' || a.source === 'session_fail';
      const bS = b.source === 'session_ok' || b.source === 'session_fail';
      if (aS && bS) return a.source === 'session_ok' ? -1 : 1;
      if (aS !== bS) return aS ? 1 : -1;
      return b.totalEth - a.totalEth;
    });

    const otherRows: GasFeeTotals['byCategory'] = [...rolled.entries()].map(([category, rows]) => {
      const m = aggregateCosts(rows, ethUsd, usdPerZar);
      return {
        category,
        label: GAS_CATEGORY_LABELS[category] ?? category,
        ...m,
      };
    });
    const byCategory = [...consumerRows, ...otherRows].sort((a, b) => b.totalEth - a.totalEth);

    const byGroup: GasFeeTotals['byGroup'] = GROUP_ORDER.flatMap(group => {
      const rows = group === 'transaction'
        ? consumerRows
        : otherRows.filter(r => r.category === group);
      if (!rows.length) return [];
      const count = rows.reduce((s, r) => s + r.count, 0);
      const totalEthG = rows.reduce((s, r) => s + r.totalEth, 0);
      const totalZarG = rows.reduce((s, r) => s + r.totalZar, 0);
      // Group last = most recent gas spend in this group.
      const allRows = group === 'transaction'
        ? [...buckets.values()].filter(b => b.category === 'transaction').flatMap(b => b.rows)
        : rolled.get(group) ?? [];
      const lastZarG = aggregateCosts(allRows, ethUsd, usdPerZar).lastZar;
      return [{
        group,
        label: GROUP_LABELS[group],
        count,
        totalEth: totalEthG,
        totalZar: totalZarG,
        zarPerTx: zarPerTx(totalZarG, count),
        lastZar: lastZarG,
        rows: rows.length > 1 || group === 'transaction' ? rows : [],
      }];
    });

    // bySource: same classification, include lastZar
    const sourceBuckets = new Map<string, { category: GasCategory; source: string; rows: CostRow[] }>();
    for (const r of gasRows.rows) {
      let source = r.source;
      if (source === 'session' || source === 'session_ok' || source === 'session_fail') {
        source = isUnsuccessfulSessionPayment(r.sale_status, r.fulfilment_status)
          ? 'session_fail'
          : 'session_ok';
      } else if (source === 'relay') {
        source = 'passkey';
      }
      const key = `${r.category}::${source}`;
      const b = sourceBuckets.get(key) ?? { category: r.category, source, rows: [] };
      b.rows.push({ cost_wei: r.cost_wei, recorded_at: r.recorded_at });
      sourceBuckets.set(key, b);
    }
    const bySource = [...sourceBuckets.values()]
      .map(b => {
        const m = aggregateCosts(b.rows, ethUsd, usdPerZar);
        return {
          source: b.source,
          label: labelForGasSource(b.source),
          category: b.category,
          ...m,
        };
      })
      .sort((a, b) => b.totalEth - a.totalEth);

    return {
      totalWei,
      totalEth,
      totalZar: ethToZar(totalEth, ethUsd, usdPerZar),
      ethUsd,
      usdPerZar,
      transactionCount: Number(total.rows[0]?.n ?? 0),
      byCategory,
      byGroup,
      bySource,
      recent: recent.rows.map(r => {
        const costEth = Number(r.cost_wei) / 1e18;
        return {
          txHash: r.tx_hash,
          source: r.source,
          label: labelForGasSource(r.source),
          category: r.category,
          gasUsed: Number(r.gas_used),
          costEth,
          costZar: ethToZar(costEth, ethUsd, usdPerZar),
          blockNumber: r.block_number ? Number(r.block_number) : null,
          recordedAt: r.recorded_at,
        };
      }),
    };
  } catch {
    return empty;
  }
}

/** ETH spent on all onboarding gas (including failed / abandoned sign-ups). */
export async function getOnboardingGasEth(): Promise<number> {
  await ensureGasCostsIndexed();
  try {
    const r = await db.query<{ wei: string }>(
      `SELECT COALESCE(SUM(cost_wei), 0)::text AS wei FROM protocol_gas_costs WHERE category = 'onboarding'`,
    );
    return Number(r.rows[0]?.wei ?? 0) / 1e18;
  } catch {
    return 0;
  }
}

/** ETH spent on onboarding for registrations that completed (consumers table), not failed attempts. */
export async function getSuccessfulOnboardingGasEth(): Promise<number> {
  await ensureGasCostsIndexed();
  try {
    const r = await db.query<{ wei: string }>(
      `SELECT COALESCE(SUM(pgc.cost_wei), 0)::text AS wei
         FROM protocol_gas_costs pgc
        WHERE pgc.category = 'onboarding'
          AND (
            EXISTS (
              SELECT 1 FROM registration_attempts ra
               WHERE ra.status = 'completed'
                 AND ra.tx_hash IS NOT NULL
                 AND LOWER(ra.tx_hash) = LOWER(pgc.tx_hash)
            )
            OR (
              pgc.source = 'register_signer'
              AND EXISTS (
                SELECT 1 FROM registration_attempts ra
                 WHERE ra.status = 'completed'
                   AND pgc.recorded_at BETWEEN ra.created_at - INTERVAL '10 minutes'
                                           AND ra.updated_at + INTERVAL '10 minutes'
              )
            )
          )`,
    );
    return Number(r.rows[0]?.wei ?? 0) / 1e18;
  } catch {
    return getOnboardingGasEth();
  }
}

export function formatEthApprox(eth: number): string {
  return `~${eth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH`;
}
