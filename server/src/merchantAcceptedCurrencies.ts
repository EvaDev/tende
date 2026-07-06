import db from './db.js';

export async function seedAcceptedCurrency(merchantId: string, currencyCode: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO merchant_accepted_currencies (merchant_id, currency_code)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [merchantId, currencyCode.toUpperCase()],
    );
  } catch (e) {
    console.warn(`[merchants] seed accepted_currencies failed for ${merchantId}:`, (e as Error).message);
  }
}

export async function getAcceptedCurrencies(merchantId: string): Promise<string[]> {
  try {
    const r = await db.query<{ currency_code: string }>(
      `SELECT currency_code FROM merchant_accepted_currencies WHERE merchant_id = $1 ORDER BY currency_code`,
      [merchantId],
    );
    return r.rows.map(x => x.currency_code);
  } catch {
    return [];
  }
}
