const SYM: Record<string, string> = { ZAR: 'R', MWK: 'MK', USD: '$', USDC: '$' };

export function currencySymbol(currency: string): string {
  return SYM[currency.toUpperCase()] ?? currency;
}

export function formatMoney(v: string | number, currency: string): string {
  const sym = currencySymbol(currency);
  const num = Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${num}`;
}
