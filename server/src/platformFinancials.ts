// Platform revenue vs expenses summary for dashboard and reports.

import db from './db.js';
import { getGasFeeTotals, getSuccessfulOnboardingGasEth } from './gasCostService.js';
import dexQuoteService from './dexQuoteService.js';
import fxService from './fxService.js';
import { ethers } from 'ethers';

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
  yieldRevenueZar: number;
  yieldRevenueDisplay: string;
  settlementFeesZar: number;
  settlementFeesDisplay: string;
  expensesZar: number;
  expensesDisplay: string;
  cacExpensesZar: number;
  cacExpensesDisplay: string;
  cacPerConsumerDisplay: string;
  transactionGasZar: number;
  transactionGasDisplay: string;
  operationsGasZar: number;
  operationsGasDisplay: string;
  deploymentGasZar: number;
  deploymentGasDisplay: string;
  expensesEth: number;
  netZar: number;
  netDisplay: string;
  yieldRevenueMinor: number;
  gasTransactionCount: number;
  ethUsd: number | null;
  usdPerZar: number | null;
}

function formatZarApprox(zar: number): string {
  return `R${zar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export async function getProtocolFinancials(completedConsumers = 0): Promise<ProtocolFinancials> {
  const [convFeesZar, yieldRev, gas] = await Promise.all([
    sumConversionFeesZar(),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM((args->>'platformCut')::numeric), 0)::text AS total
         FROM chain_events WHERE event_name = 'YieldHarvested'`,
    ).catch(() => ({ rows: [{ total: '0' }] })),
    getGasFeeTotals(),
  ]);

  const conversionFeesZar = convFeesZar;
  const settlementFees = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(fee_amount), 0)::text AS total FROM settlement_requests WHERE status = 'executed'`,
  ).catch(() => ({ rows: [{ total: '0' }] }));
  const settlementFeesZar = Number(settlementFees.rows[0]?.total ?? 0);
  const yieldRevZar = await yieldRevenueZar();
  const yieldRevenueMinor = Number(yieldRev.rows[0]?.total ?? 0);
  const revenueZar = conversionFeesZar + settlementFeesZar + yieldRevZar;

  const onboardingEth = await getSuccessfulOnboardingGasEth();
  const transactionEth = gas.byCategory.find(c => c.category === 'transaction')?.totalEth ?? 0;
  const operationsEth = gas.byCategory.find(c => c.category === 'operations')?.totalEth ?? 0;
  const deploymentEth = gas.byCategory.find(c => c.category === 'deployment')?.totalEth ?? 0;

  const { zar: expensesZar, ethUsd, usdPerZar } = await ethToZar(gas.totalEth);
  const { zar: cacExpensesZar } = await ethToZar(onboardingEth);
  const { zar: transactionGasZar } = await ethToZar(transactionEth);
  const { zar: operationsGasZar } = await ethToZar(operationsEth);
  const { zar: deploymentGasZar } = await ethToZar(deploymentEth);
  const netZar = revenueZar - expensesZar;
  const cacPerConsumer = completedConsumers > 0 ? cacExpensesZar / completedConsumers : 0;

  return {
    revenueZar,
    revenueDisplay: formatZarApprox(revenueZar),
    conversionFeesZar,
    conversionFeesDisplay: formatZarApprox(conversionFeesZar),
    yieldRevenueZar: yieldRevZar,
    yieldRevenueDisplay: formatZarApprox(yieldRevZar),
    settlementFeesZar,
    settlementFeesDisplay: formatZarApprox(settlementFeesZar),
    expensesZar,
    expensesDisplay: formatZarApprox(expensesZar),
    cacExpensesZar,
    cacExpensesDisplay: formatZarApprox(cacExpensesZar),
    cacPerConsumerDisplay: completedConsumers > 0
      ? `${formatZarApprox(cacPerConsumer)} CAC per consumer`
      : '',
    transactionGasZar,
    transactionGasDisplay: formatZarApprox(transactionGasZar),
    operationsGasZar,
    operationsGasDisplay: formatZarApprox(operationsGasZar),
    deploymentGasZar,
    deploymentGasDisplay: formatZarApprox(deploymentGasZar),
    expensesEth: gas.totalEth,
    netZar,
    netDisplay: formatZarApprox(netZar),
    yieldRevenueMinor,
    gasTransactionCount: gas.transactionCount,
    ethUsd,
    usdPerZar,
  };
}
