// Tracks ETH gas paid by the platform backend signer (relayer wallet).

import { ethers } from 'ethers';
import config from './config.js';
import db from './db.js';

export type GasCategory = 'onboarding' | 'transaction' | 'operations' | 'deployment';

export const GAS_CATEGORY_LABELS: Record<GasCategory, string> = {
  onboarding:  'Customer acquisition (onboarding)',
  transaction: 'Consumer transactions (relay)',
  operations:  'Platform operations',
  deployment:  'Contract deployments',
};

/** Map a granular source tag to a reporting category. */
export function categoryForSource(source: string): GasCategory {
  if (source.startsWith('register_')) return 'onboarding';
  if (source === 'relay') return 'transaction';
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
      source: 'relay',
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
      const { source, category } = await classifyTxHash(hash);
      await recordGasFromReceipt(receipt, source, category);
    }
  } catch {
    // protocol_gas_costs table may not exist yet.
  }
}

export interface GasFeeTotals {
  totalWei: string;
  totalEth: number;
  transactionCount: number;
  byCategory: { category: GasCategory; label: string; count: number; totalEth: number }[];
  bySource: { source: string; category: GasCategory; count: number; totalEth: number }[];
  recent: {
    txHash: string;
    source: string;
    category: GasCategory;
    gasUsed: number;
    costEth: number;
    blockNumber: number | null;
    recordedAt: string;
  }[];
}

export async function getGasFeeTotals(): Promise<GasFeeTotals> {
  await ensureGasCostsIndexed();
  try {
    const total = await db.query<{ wei: string; n: string }>(
      `SELECT COALESCE(SUM(cost_wei), 0)::text AS wei, COUNT(*)::text AS n FROM protocol_gas_costs`,
    );
    const byCategory = await db.query<{ category: GasCategory; n: string; wei: string }>(
      `SELECT category, COUNT(*)::text AS n, COALESCE(SUM(cost_wei), 0)::text AS wei
         FROM protocol_gas_costs GROUP BY category ORDER BY SUM(cost_wei) DESC`,
    );
    const bySource = await db.query<{ source: string; category: GasCategory; n: string; wei: string }>(
      `SELECT source, category, COUNT(*)::text AS n, COALESCE(SUM(cost_wei), 0)::text AS wei
         FROM protocol_gas_costs GROUP BY source, category ORDER BY SUM(cost_wei) DESC`,
    );
    const recent = await db.query<{
      tx_hash: string; source: string; category: GasCategory; gas_used: string; cost_wei: string;
      block_number: string | null; recorded_at: string;
    }>(
      `SELECT tx_hash, source, category, gas_used::text, cost_wei::text, block_number::text, recorded_at
         FROM protocol_gas_costs ORDER BY recorded_at DESC LIMIT 50`,
    );
    const totalWei = total.rows[0]?.wei ?? '0';
    const totalEth = Number(totalWei) / 1e18;
    return {
      totalWei,
      totalEth,
      transactionCount: Number(total.rows[0]?.n ?? 0),
      byCategory: byCategory.rows.map(r => ({
        category: r.category,
        label: GAS_CATEGORY_LABELS[r.category] ?? r.category,
        count: Number(r.n),
        totalEth: Number(r.wei) / 1e18,
      })),
      bySource: bySource.rows.map(r => ({
        source: r.source,
        category: r.category,
        count: Number(r.n),
        totalEth: Number(r.wei) / 1e18,
      })),
      recent: recent.rows.map(r => ({
        txHash: r.tx_hash,
        source: r.source,
        category: r.category,
        gasUsed: Number(r.gas_used),
        costEth: Number(r.cost_wei) / 1e18,
        blockNumber: r.block_number ? Number(r.block_number) : null,
        recordedAt: r.recorded_at,
      })),
    };
  } catch {
    return { totalWei: '0', totalEth: 0, transactionCount: 0, byCategory: [], bySource: [], recent: [] };
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
