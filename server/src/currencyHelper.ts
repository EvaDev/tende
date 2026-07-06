import db from './db.js';

const SYMBOL_FALLBACK: Record<string, string> = {
  ZAR: 'R', USD: '$', USDC: '$', MWK: 'MK', EUR: '€', GBP: '£',
};

/** Vault ledger decimals: USDC = 6, fiat claims = 2. */
export function currencyDecimals(currencyCode: string): number {
  return currencyCode.toUpperCase() === 'USDC' ? 6 : 2;
}

export function currencySymbol(currencyCode: string, fromDb?: string | null): string {
  if (fromDb?.trim()) return fromDb.trim();
  return SYMBOL_FALLBACK[currencyCode.toUpperCase()] ?? currencyCode.toUpperCase();
}

/** Home fiat for a consumer's registered country. */
export async function spendCurrencyForCountry(countryCode: string): Promise<{ currency: string; symbol: string; decimals: number }> {
  const r = await db.query<{ currency_code: string; currency_symbol: string | null; decimals: number }>(
    `SELECT co.currency_code, cu.currency_symbol, cu.decimals
       FROM countries co
       JOIN currencies cu ON cu.currency_code = co.currency_code
      WHERE co.country_code = $1`,
    [countryCode.toUpperCase()],
  );
  if (!r.rows.length) {
    return { currency: 'ZAR', symbol: 'R', decimals: 2 };
  }
  const row = r.rows[0];
  return {
    currency: row.currency_code,
    symbol: currencySymbol(row.currency_code, row.currency_symbol),
    decimals: row.decimals ?? 2,
  };
}

/** Treasury token for a fiat corridor (e.g. ZAR→TTZA, MWK→TTMW). */
export async function treasuryCorridorForFiat(fiatCode: string): Promise<string | null> {
  const r = await db.query<{ internal_code: string }>(
    `SELECT s.internal_code
       FROM stablecoins s
       JOIN currencies cu ON cu.currency_code = s.internal_code
      WHERE s.is_treasury_token = TRUE
        AND cu.base_currency_code = $1
      ORDER BY s.is_primary DESC NULLS LAST
      LIMIT 1`,
    [fiatCode.toUpperCase()],
  );
  return r.rows[0]?.internal_code ?? null;
}

/** Validate country → currency pairing for store setup. */
export async function currencyForCountry(countryCode: string): Promise<string> {
  const r = await db.query<{ currency_code: string }>(
    `SELECT currency_code FROM countries WHERE country_code = $1`,
    [countryCode.toUpperCase()],
  );
  if (!r.rows.length) throw Object.assign(new Error('Unknown country'), { status: 400 });
  return r.rows[0].currency_code;
}
