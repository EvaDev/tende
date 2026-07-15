// Platform revenue vs expenses summary for dashboard and reports.

import db from './db.js';
import { getGasFeeTotals, getSuccessfulOnboardingGasEth } from './gasCostService.js';
import dexQuoteService from './dexQuoteService.js';
import fxService from './fxService.js';
import { getHarvestableYield } from './treasuryService.js';
import config from './config.js';
import { ethers } from 'ethers';
import { getWithdrawalSummary } from './withdrawalService.js';

const WETH_MAINNET = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const CURRENCY_BY_HASH: Record<string, string> = {};
for (const code of ['ZAR', 'USDC', 'USD', 'ZWL', 'MWK']) {
  CURRENCY_BY_HASH[ethers.id(code).toLowerCase()] = code;
}
const REVENUE_DECIMALS: Record<string, number> = { USDC: 6, USD: 6 };

function decodeCurrencyHash(hash: unknown): string {
  const h = String(hash ?? '').toLowerCase();
  return CURRENCY_BY_HASH[h] ?? 'UNKNOWN';
}

async function yieldRevenueZar(): Promise<number> {
  const r = await db.query<{ currency_hash: string; total: string }>(
    `SELECT args->>'currencyCode' AS currency_hash,
            COALESCE(SUM((args->>'platformCut')::numeric), 0)::text AS total
       FROM chain_events WHERE event_name = 'YieldHarvested'
       GROUP BY args->>'currencyCode'`,
  ).catch(() => ({ rows: [] as { currency_hash: string; total: string }[] }));

  const zarUsd = (await fxService.getRate('ZAR', 'USD')).rate;
  let total = 0;
  for (const row of r.rows) {
    const code = decodeCurrencyHash(row.currency_hash);
    const dec = REVENUE_DECIMALS[code] ?? 2;
    const major = Number(row.total ?? 0) / 10 ** dec;
    if (code === 'USDC' || code === 'USD') {
      if (zarUsd && zarUsd > 0) total += major / zarUsd;
    } else {
      total += major;
    }
  }
  return total;
}

export interface ProtocolFinancials {
  revenueZar: number;
  revenueDisplay: string;
  conversionFeesZar: number;
  conversionFeesDisplay: string;
  conversionCount: number;
  yieldRevenueZar: number;
  yieldRevenueDisplay: string;
  yieldHarvestDue: boolean;
  settlementFeesZar: number;
  settlementFeesDisplay: string;
  settlementCount: number;
  withdrawalFeesZar: number;
  withdrawalFeesDisplay: string;
  withdrawalCount: number;
  withdrawalNetUsdc: number;
  withdrawalNetDisplay: string;
  expensesZar: number;
  expensesDisplay: string;
  cacExpensesZar: number;
  cacExpensesDisplay: string;
  cacCount: number;
  cacPerConsumerDisplay: string;
  transactionGasZar: number;
  transactionGasDisplay: string;
  transactionCount: number;
  operationsGasZar: number;
  operationsGasDisplay: string;
  operationsCount: number;
  deploymentGasZar: number;
  deploymentGasDisplay: string;
  deploymentCount: number;
  expensesEth: number;
  netZar: number;
  netDisplay: string;
  tradingSinceDisplay: string;
  yieldRevenueMinor: number;
  gasTransactionCount: number;
  ethUsd: number | null;
  usdPerZar: number | null;
}

function formatZarApprox(zar: number): string {
  return `R${zar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTradingSince(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function getFirstTradingDate(): Promise<Date | null> {
  const chain = await db.query<{ t: Date | null }>(
    `SELECT MIN(block_time) AS t FROM chain_events WHERE block_time IS NOT NULL`,
  ).catch(() => ({ rows: [{ t: null }] }));
  if (chain.rows[0]?.t) return chain.rows[0].t;

  const gas = await db.query<{ t: Date | null }>(
    `SELECT MIN(recorded_at) AS t FROM protocol_gas_costs`,
  ).catch(() => ({ rows: [{ t: null }] }));
  return gas.rows[0]?.t ?? null;
}

async function ethToZar(eth: number): Promise<{ zar: number; ethUsd: number | null; usdPerZar: number | null }> {
  if (eth === 0) return { zar: 0, ethUsd: null, usdPerZar: null };

  const [ethQuote, zarUsd] = await Promise.all([
    dexQuoteService.getPriceUsd({ contract_address: WETH_MAINNET, decimals: 18, pool_fee_tier: 500 }),
    fxService.getRate('ZAR', 'USD'),
  ]);

  const ethUsd = ethQuote.priceUsd;
  const usdPerZar = zarUsd.rate;
  if (ethUsd == null || usdPerZar == null || usdPerZar <= 0) {
    return { zar: 0, ethUsd, usdPerZar };
  }

  const expensesUsd = eth * ethUsd;
  const expensesZar = expensesUsd / usdPerZar;
  return { zar: expensesZar, ethUsd, usdPerZar };
}

async function sumConversionFeesZar(): Promise<number> {
  const r = await db.query<{ fee_currency: string; total: string }>(
    `SELECT fee_currency, COALESCE(SUM(fee_amount), 0)::text AS total
       FROM consumer_conversions GROUP BY fee_currency`,
  ).catch(() => ({ rows: [] as { fee_currency: string; total: string }[] }));

  const zarUsd = (await fxService.getRate('ZAR', 'USD')).rate;
  let total = 0;
  for (const row of r.rows) {
    const code = row.fee_currency.toUpperCase();
    const dec = REVENUE_DECIMALS[code] ?? 2;
    const major = Number(row.total ?? 0) / 10 ** dec;
    if (code === 'USD' || code === 'USDC') {
      if (zarUsd && zarUsd > 0) total += major / zarUsd;
    } else {
      total += major;
    }
  }
  return total;
}

async function anyHarvestDue(): Promise<boolean> {
  // Pilot dashboard: check ZAR plus any configured cash corridor currencies.
  const codes = Array.from(new Set(['ZAR', ...config.platform.cashCurrencies]));
  for (const code of codes) {
    try {
      const raw = await getHarvestableYield(code);
      if (BigInt(raw) > 0n) return true;
    } catch {
      // Vault / RPC unavailable — don't block financials.
    }
  }
  return false;
}

export async function getProtocolFinancials(completedConsumers = 0): Promise<ProtocolFinancials> {
  const [convFeesZar, yieldRev, gas, conversionCountRow, settlementRow, harvestDue, withdrawals] = await Promise.all([
    sumConversionFeesZar(),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM((args->>'platformCut')::numeric), 0)::text AS total
         FROM chain_events WHERE event_name = 'YieldHarvested'`,
    ).catch(() => ({ rows: [{ total: '0' }] })),
    getGasFeeTotals(),
    db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM consumer_conversions`,
    ).catch(() => ({ rows: [{ n: '0' }] })),
    db.query<{ total: string; n: string }>(
      `SELECT COALESCE(SUM(fee_amount), 0)::text AS total, COUNT(*)::text AS n
         FROM settlement_requests WHERE status = 'executed'`,
    ).catch(() => ({ rows: [{ total: '0', n: '0' }] })),
    anyHarvestDue(),
    getWithdrawalSummary(),
  ]);

  const conversionFeesZar = convFeesZar;
  const conversionCount = Number(conversionCountRow.rows[0]?.n ?? 0);
  const settlementFeesZar = Number(settlementRow.rows[0]?.total ?? 0);
  const settlementCount = Number(settlementRow.rows[0]?.n ?? 0);
  const yieldRevZar = await yieldRevenueZar();
  const yieldRevenueMinor = Number(yieldRev.rows[0]?.total ?? 0);

  const { zar: expensesZar, ethUsd, usdPerZar } = await ethToZar(gas.totalEth);
  const withdrawalFeesZar = (usdPerZar && usdPerZar > 0)
    ? withdrawals.feeUsdc / usdPerZar
    : 0;
  const revenueZar = conversionFeesZar + settlementFeesZar + yieldRevZar + withdrawalFeesZar;

  const onboardingEth = await getSuccessfulOnboardingGasEth();
  const catRows = (c: string) => gas.byCategory.filter(x => x.category === c);
  const catCount = (c: string) => catRows(c).reduce((s, x) => s + x.count, 0);
  const catEth = (c: string) => catRows(c).reduce((s, x) => s + x.totalEth, 0);
  const transactionEth = catEth('transaction');
  const operationsEth = catEth('operations');
  const deploymentEth = catEth('deployment');

  const { zar: cacExpensesZar } = await ethToZar(onboardingEth);
  const { zar: transactionGasZar } = await ethToZar(transactionEth);
  const { zar: operationsGasZar } = await ethToZar(operationsEth);
  const { zar: deploymentGasZar } = await ethToZar(deploymentEth);
  const netZar = revenueZar - expensesZar;
  const cacPerConsumer = completedConsumers > 0 ? cacExpensesZar / completedConsumers : 0;
  const tradingSince = await getFirstTradingDate();

  return {
    revenueZar,
    revenueDisplay: formatZarApprox(revenueZar),
    conversionFeesZar,
    conversionFeesDisplay: formatZarApprox(conversionFeesZar),
    conversionCount,
    yieldRevenueZar: yieldRevZar,
    yieldRevenueDisplay: formatZarApprox(yieldRevZar),
    yieldHarvestDue: harvestDue,
    settlementFeesZar,
    settlementFeesDisplay: formatZarApprox(settlementFeesZar),
    settlementCount,
    withdrawalFeesZar,
    withdrawalFeesDisplay: formatZarApprox(withdrawalFeesZar),
    withdrawalCount: withdrawals.count,
    withdrawalNetUsdc: withdrawals.netUsdc,
    withdrawalNetDisplay: withdrawals.netDisplay,
    expensesZar,
    expensesDisplay: formatZarApprox(expensesZar),
    cacExpensesZar,
    cacExpensesDisplay: formatZarApprox(cacExpensesZar),
    cacCount: completedConsumers,
    cacPerConsumerDisplay: completedConsumers > 0 ? formatZarApprox(cacPerConsumer) : '',
    transactionGasZar,
    transactionGasDisplay: formatZarApprox(transactionGasZar),
    transactionCount: catCount('transaction'),
    operationsGasZar,
    operationsGasDisplay: formatZarApprox(operationsGasZar),
    operationsCount: catCount('operations'),
    deploymentGasZar,
    deploymentGasDisplay: formatZarApprox(deploymentGasZar),
    deploymentCount: catCount('deployment'),
    expensesEth: gas.totalEth,
    netZar,
    netDisplay: formatZarApprox(netZar),
    tradingSinceDisplay: tradingSince ? `Since ${formatTradingSince(tradingSince)}` : '',
    yieldRevenueMinor,
    gasTransactionCount: gas.transactionCount,
    ethUsd,
    usdPerZar,
  };
}
