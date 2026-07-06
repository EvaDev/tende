// Consumer FX: each treasury corridor (TTZA, TTMW, …) converts only to/from USD.
// No direct treasury-to-treasury (e.g. MWK↔ZAR / TTMW↔TTZA).

import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import db from './db.js';
import config from './config.js';
import fxService from './fxService.js';
import { getRevenueConfig } from './revenueConfig.js';
import { unifiedBalanceOf } from './safeRelayService.js';
import { spendCurrencyForCountry, treasuryCorridorForFiat } from './currencyHelper.js';
import { currencyDecimals } from './currencyHelper.js';
import {
  vaultAdminCredit,
  vaultAdminDebit,
  creditFiatWithTreasuryBacking,
  unallocatedTreasuryBacking,
  usdcReserveUnits,
} from './treasuryService.js';

export interface ConvertResult {
  from: string;
  to: string;
  debited: { amount: string; currency: string };
  credited: { amount: string; currency: string };
  rate: number;
  spreadBps: number;
  fee: string;
  debitTx: string;
  creditTx: string;
  reference: string;
  mintTx?: string;
  source: string;
}

/** Treasury token in the vault not currently backing any user's on-chain fiat claim. */
export async function unallocatedTreasuryForFiat(fiatCode: string): Promise<bigint> {
  return unallocatedTreasuryBacking(fiatCode);
}

/** @deprecated use unallocatedTreasuryForFiat('ZAR') */
export async function unallocatedTtzaInVault(): Promise<bigint> {
  return unallocatedTreasuryForFiat('ZAR');
}

/** Credit a fiat claim; mint treasury token into the vault only when backing is short. */
export async function creditFiatWithTreasury(
  wallet: string,
  fiatUnits: bigint,
  fiatCode: string,
): Promise<{ creditTx: string; mintTx?: string }> {
  return creditFiatWithTreasuryBacking(wallet, fiatUnits, fiatCode);
}

/** @deprecated use creditFiatWithTreasury */
export async function creditZarWithTtzaBacking(
  wallet: string,
  zarUnits: bigint,
): Promise<{ creditTx: string; mintTx?: string }> {
  return creditFiatWithTreasury(wallet, zarUnits, 'ZAR');
}

async function persistConversion(row: {
  wallet: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: bigint;
  toAmount: bigint;
  rate: number;
  spreadBps: number;
  feeAmount: bigint;
  feeCurrency: string;
  debitTx: string;
  creditTx: string;
  reference: string;
  mintTx?: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO consumer_conversions
       (wallet, from_currency, to_currency, from_amount, to_amount, rate, spread_bps,
        fee_amount, fee_currency, debit_tx, credit_tx, reference, mint_tx)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      row.wallet.toLowerCase(),
      row.fromCurrency,
      row.toCurrency,
      row.fromAmount.toString(),
      row.toAmount.toString(),
      row.rate,
      row.spreadBps,
      row.feeAmount.toString(),
      row.feeCurrency,
      row.debitTx,
      row.creditTx,
      row.reference,
      row.mintTx ?? null,
    ],
  ).catch(e => console.error('[conversion] failed to record conversion', e));
}

function newConversionReference(fromCurrency: string, toCurrency: string): string {
  const pair = `${fromCurrency.slice(0, 1)}${toCurrency.slice(0, 1)}`.toUpperCase();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `FX-${pair}-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function convertFiatToUsd(wallet: string, amount: string, fiatCode: string): Promise<ConvertResult> {
  const fiat = fiatCode.toUpperCase();
  const dec = currencyDecimals(fiat);
  let fiatUnits: bigint;
  try { fiatUnits = ethers.parseUnits(String(amount), dec); } catch { throw Object.assign(new Error('Invalid amount'), { status: 400 }); }
  if (fiatUnits <= 0n) throw Object.assign(new Error('Amount must be positive'), { status: 400 });

  const fiatBal = await unifiedBalanceOf(wallet, fiat);
  if (fiatBal < fiatUnits) {
    throw Object.assign(new Error(`Insufficient ${fiat} balance`), { status: 409, code: 'INSUFFICIENT_BALANCE' });
  }

  const quote = await fxService.getRate(fiat, 'USD');
  if (quote.rate == null || quote.rate <= 0) {
    throw Object.assign(new Error('FX rate is unavailable right now — please try again shortly'), { status: 503, code: 'FX_UNAVAILABLE' });
  }

  const { fxSpreadBps } = await getRevenueConfig();
  const fiatFloat = Number(fiatUnits) / 10 ** dec;
  const usdNet = fiatFloat * quote.rate * (1 - fxSpreadBps / 10_000);
  const usdcUnits = BigInt(Math.floor(usdNet * 1e6));
  if (usdcUnits <= 0n) throw Object.assign(new Error('Amount is too small to convert'), { status: 400 });

  const reserve = await usdcReserveUnits();
  if (reserve < usdcUnits) {
    throw Object.assign(new Error('USD reserve is temporarily low — try a smaller amount or again later'), { status: 409, code: 'RESERVE_LOW' });
  }

  const debitTx = await vaultAdminDebit(wallet, fiatUnits, fiat);
  const creditTx = await vaultAdminCredit(wallet, usdcUnits, 'USDC');
  const feeFiatUnits = (fiatUnits * BigInt(fxSpreadBps)) / 10_000n;
  const reference = newConversionReference(fiat, 'USD');

  await persistConversion({
    wallet,
    fromCurrency: fiat,
    toCurrency: 'USD',
    fromAmount: fiatUnits,
    toAmount: usdcUnits,
    rate: quote.rate,
    spreadBps: fxSpreadBps,
    feeAmount: feeFiatUnits,
    feeCurrency: fiat,
    debitTx,
    creditTx,
    reference,
  });

  return {
    from: fiat,
    to: 'USD',
    debited: { amount: ethers.formatUnits(fiatUnits, dec), currency: fiat },
    credited: { amount: ethers.formatUnits(usdcUnits, 6), currency: 'USD' },
    rate: quote.rate,
    spreadBps: fxSpreadBps,
    fee: ethers.formatUnits(feeFiatUnits, dec),
    debitTx,
    creditTx,
    reference,
    source: quote.source,
  };
}

/** @deprecated use convertFiatToUsd(wallet, amount, 'ZAR') */
export async function convertZarToUsd(wallet: string, amount: string): Promise<ConvertResult> {
  return convertFiatToUsd(wallet, amount, 'ZAR');
}

export async function convertUsdToFiat(wallet: string, amount: string, fiatCode: string): Promise<ConvertResult> {
  const fiat = fiatCode.toUpperCase();
  const dec = currencyDecimals(fiat);
  let usdcUnits: bigint;
  try { usdcUnits = ethers.parseUnits(String(amount), 6); } catch { throw Object.assign(new Error('Invalid amount'), { status: 400 }); }
  if (usdcUnits <= 0n) throw Object.assign(new Error('Amount must be positive'), { status: 400 });

  const usdcBal = await unifiedBalanceOf(wallet, 'USDC');
  if (usdcBal < usdcUnits) {
    throw Object.assign(new Error('Insufficient USD balance'), { status: 409, code: 'INSUFFICIENT_BALANCE' });
  }

  const quote = await fxService.getRate('USD', fiat);
  if (quote.rate == null || quote.rate <= 0) {
    throw Object.assign(new Error('FX rate is unavailable right now — please try again shortly'), { status: 503, code: 'FX_UNAVAILABLE' });
  }

  const { fxSpreadBps } = await getRevenueConfig();
  const usdFloat = Number(usdcUnits) / 1e6;
  const fiatNet = usdFloat * quote.rate * (1 - fxSpreadBps / 10_000);
  const fiatUnits = BigInt(Math.floor(fiatNet * 10 ** dec));
  if (fiatUnits <= 0n) throw Object.assign(new Error('Amount is too small to convert'), { status: 400 });

  const debitTx = await vaultAdminDebit(wallet, usdcUnits, 'USDC');
  const { creditTx, mintTx } = await creditFiatWithTreasury(wallet, fiatUnits, fiat);
  const feeUsdcUnits = (usdcUnits * BigInt(fxSpreadBps)) / 10_000n;
  const reference = newConversionReference('USD', fiat);

  await persistConversion({
    wallet,
    fromCurrency: 'USD',
    toCurrency: fiat,
    fromAmount: usdcUnits,
    toAmount: fiatUnits,
    rate: quote.rate,
    spreadBps: fxSpreadBps,
    feeAmount: feeUsdcUnits,
    feeCurrency: 'USD',
    debitTx,
    creditTx,
    reference,
    mintTx,
  });

  return {
    from: 'USD',
    to: fiat,
    debited: { amount: ethers.formatUnits(usdcUnits, 6), currency: 'USD' },
    credited: { amount: ethers.formatUnits(fiatUnits, dec), currency: fiat },
    rate: quote.rate,
    spreadBps: fxSpreadBps,
    fee: ethers.formatUnits(feeUsdcUnits, 6),
    debitTx,
    creditTx,
    reference,
    mintTx,
    source: quote.source,
  };
}

/** @deprecated use convertUsdToFiat(wallet, amount, 'ZAR') */
export async function convertUsdToZar(wallet: string, amount: string): Promise<ConvertResult> {
  return convertUsdToFiat(wallet, amount, 'ZAR');
}

function isUsdCode(currency: string): boolean {
  const u = currency.toUpperCase();
  return u === 'USD' || u === 'USDC';
}

async function homeFiatForWallet(wallet: string): Promise<string> {
  const r = await db.query<{ country_code: string }>(
    `SELECT country_code FROM consumers WHERE LOWER(wallet_address) = $1 LIMIT 1`,
    [wallet.toLowerCase()],
  );
  const meta = await spendCurrencyForCountry(r.rows[0]?.country_code ?? 'ZA');
  return meta.currency;
}

/** Only local↔USD and ZAR↔USD — never treasury corridor to treasury corridor. */
export async function assertAllowedConversion(wallet: string, fromRaw: string, toRaw: string): Promise<void> {
  const from = fromRaw.toUpperCase();
  const to = toRaw.toUpperCase();
  const local = await homeFiatForWallet(wallet);

  const fiatFrom = isUsdCode(from) ? null : from;
  const fiatTo = isUsdCode(to) ? null : to;

  if (fiatFrom && fiatTo) {
    const [corridorFrom, corridorTo] = await Promise.all([
      treasuryCorridorForFiat(fiatFrom),
      treasuryCorridorForFiat(fiatTo),
    ]);
    throw Object.assign(
      new Error(
        corridorFrom && corridorTo && corridorFrom !== corridorTo
          ? `Conversions between ${corridorFrom} and ${corridorTo} are not supported — convert via USD`
          : 'Conversions between treasury currencies are not supported — convert via USD',
      ),
      { status: 400, code: 'TREASURY_TO_TREASURY' },
    );
  }

  if (!fiatFrom && !fiatTo) {
    throw Object.assign(new Error('Conversions must be to or from USD'), { status: 400, code: 'INVALID_PAIR' });
  }

  const fiatLeg = (fiatFrom ?? fiatTo)!;
  const corridor = await treasuryCorridorForFiat(fiatLeg);
  if (!corridor) {
    throw Object.assign(
      new Error('Only treasury-backed currencies can be converted to/from USD'),
      { status: 400, code: 'INVALID_PAIR' },
    );
  }

  const allowedFiats = local === 'ZAR' ? new Set(['ZAR']) : new Set([local, 'ZAR']);
  if (!allowedFiats.has(fiatLeg)) {
    throw Object.assign(
      new Error(local === 'ZAR'
        ? 'Only ZAR can be converted to/from USD'
        : `Only ${local} or ZAR can be converted to/from USD`),
      { status: 400, code: 'INVALID_PAIR' },
    );
  }
}

export async function executeConversion(
  wallet: string,
  amount: string,
  fromRaw: string,
  toRaw: string,
): Promise<ConvertResult> {
  await assertAllowedConversion(wallet, fromRaw, toRaw);

  const from = fromRaw.toUpperCase();
  const to = toRaw.toUpperCase();
  if (!isUsdCode(from) && isUsdCode(to)) {
    return convertFiatToUsd(wallet, amount, from);
  }
  if (isUsdCode(from) && !isUsdCode(to)) {
    return convertUsdToFiat(wallet, amount, to);
  }
  throw Object.assign(
    new Error('Only treasury currency ↔ USD conversions are supported (not treasury to treasury)'),
    { status: 400, code: 'INVALID_PAIR' },
  );
}
