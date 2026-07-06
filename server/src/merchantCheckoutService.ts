// Cross-border merchant checkout: ring up in store currency (MWK), pay in settlement
// currency (ZAR) with a live FX quote — direct consumer→merchant TTZA transfer.

import db from './db.js';
import fxService from './fxService.js';
import { getAcceptedCurrencies, seedAcceptedCurrency } from './merchantAcceptedCurrencies.js';

export interface CheckoutQuote {
  crossBorder: boolean;
  chargeAmount: string;
  chargeCurrency: string;
  payAmount: string;
  payCurrency: string;
  /** Store-currency units received per 1 pay-currency unit (e.g. MWK per ZAR). */
  fxRate: number;
  fxSource: string;
  fxAsOf: string | null;
}

export interface ResolvedCheckout extends CheckoutQuote {
  merchantId: string;
  storeId: string | null;
}

interface MerchantRow {
  merchant_id: string;
  wallet_address: string | null;
  settlement_currency: string | null;
  currency_code: string;
}

function roundPay(amount: number, decimals = 2): string {
  const factor = 10 ** decimals;
  return (Math.ceil(amount * factor) / factor).toFixed(decimals);
}

function parsePositiveAmount(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  }
  return n;
}

async function loadMerchant(merchantId: string): Promise<MerchantRow> {
  const r = await db.query<MerchantRow>(
    `SELECT merchant_id, wallet_address, settlement_currency, currency_code
       FROM merchants WHERE merchant_id = $1`,
    [merchantId],
  );
  if (!r.rows.length) throw Object.assign(new Error('Merchant not found'), { status: 404 });
  return r.rows[0];
}

async function loadStore(merchantId: string, storeId: string): Promise<{ store_id: string; currency_code: string }> {
  const r = await db.query<{ store_id: string; currency_code: string }>(
    `SELECT store_id, currency_code FROM merchant_stores
      WHERE store_id = $1 AND merchant_id = $2 AND is_active = TRUE`,
    [storeId, merchantId],
  );
  if (!r.rows.length) throw Object.assign(new Error('Store not found'), { status: 404 });
  return r.rows[0];
}

function settlementCurrency(merchant: MerchantRow): string {
  return (merchant.settlement_currency ?? merchant.currency_code).toUpperCase();
}

async function computePayFromCharge(
  chargeAmount: string,
  chargeCurrency: string,
  payCurrency: string,
): Promise<Pick<CheckoutQuote, 'payAmount' | 'payCurrency' | 'fxRate' | 'fxSource' | 'fxAsOf'>> {
  const charge = chargeCurrency.toUpperCase();
  const pay = payCurrency.toUpperCase();
  if (charge === pay) {
    return {
      payAmount: parsePositiveAmount(chargeAmount, 'charge amount').toFixed(2),
      payCurrency: pay,
      fxRate: 1,
      fxSource: 'identity',
      fxAsOf: null,
    };
  }

  const quote = await fxService.getRate(pay, charge);
  if (quote.rate == null || quote.rate <= 0) {
    throw Object.assign(
      new Error(`FX rate ${pay}/${charge} is unavailable — try again shortly`),
      { status: 503, code: 'FX_UNAVAILABLE' },
    );
  }

  const chargeNum = parsePositiveAmount(chargeAmount, 'charge amount');
  const payNum = chargeNum / quote.rate;
  if (payNum <= 0) {
    throw Object.assign(new Error('Amount is too small to pay'), { status: 400 });
  }

  return {
    payAmount: roundPay(payNum),
    payCurrency: pay,
    fxRate: quote.rate,
    fxSource: quote.source,
    fxAsOf: quote.asOf,
  };
}

export async function quoteMerchantCheckout(input: {
  merchantId: string;
  storeId?: string;
  chargeAmount: string;
  chargeCurrency: string;
  payCurrency?: string;
}): Promise<CheckoutQuote> {
  const merchant = await loadMerchant(input.merchantId);
  const chargeCurrency = input.chargeCurrency.toUpperCase();
  const chargeAmount = parsePositiveAmount(input.chargeAmount, 'charge amount').toFixed(2);

  if (input.storeId) {
    const store = await loadStore(input.merchantId, input.storeId);
    if (store.currency_code.toUpperCase() !== chargeCurrency) {
      throw Object.assign(
        new Error(`Charge currency must match store currency (${store.currency_code})`),
        { status: 400 },
      );
    }
  }

  const settle = settlementCurrency(merchant);
  const payCurrency = (input.payCurrency ?? settle).toUpperCase();
  const crossBorder = chargeCurrency !== payCurrency;

  if (crossBorder) {
    if (payCurrency !== settle) {
      throw Object.assign(
        new Error(`This store settles in ${settle} — cross-border payment must be in ${settle}`),
        { status: 400 },
      );
    }
    const accepted = await getAcceptedCurrencies(input.merchantId);
    if (!accepted.includes(payCurrency)) {
      await seedAcceptedCurrency(input.merchantId, payCurrency);
    }
  } else if (payCurrency !== chargeCurrency) {
    throw Object.assign(new Error('Payment currency must match the charge'), { status: 400 });
  }

  const fx = await computePayFromCharge(chargeAmount, chargeCurrency, payCurrency);

  return {
    crossBorder,
    chargeAmount,
    chargeCurrency,
    ...fx,
  };
}

export async function resolveMerchantCheckout(input: {
  merchantId: string;
  merchantWallet: string;
  storeId?: string;
  chargeAmount: string;
  chargeCurrency: string;
  payCurrency?: string;
  clientPayAmount?: string;
}): Promise<ResolvedCheckout> {
  const merchant = await loadMerchant(input.merchantId);
  if (!merchant.wallet_address
    || merchant.wallet_address.toLowerCase() !== input.merchantWallet.toLowerCase()) {
    throw Object.assign(new Error('Merchant wallet mismatch'), { status: 400 });
  }

  const quote = await quoteMerchantCheckout({
    merchantId: input.merchantId,
    storeId: input.storeId,
    chargeAmount: input.chargeAmount,
    chargeCurrency: input.chargeCurrency,
    payCurrency: input.payCurrency,
  });

  if (input.clientPayAmount != null) {
    const client = parsePositiveAmount(input.clientPayAmount, 'pay amount');
    const server = parsePositiveAmount(quote.payAmount, 'pay amount');
    if (Math.abs(client - server) > 0.02) {
      throw Object.assign(
        new Error('Payment amount is out of date — refresh the quote and try again'),
        { status: 409, code: 'QUOTE_STALE' },
      );
    }
  }

  return {
    ...quote,
    merchantId: input.merchantId,
    storeId: input.storeId ?? null,
  };
}
