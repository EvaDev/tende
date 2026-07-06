import db from './db.js';
import { currencyForCountry } from './currencyHelper.js';

export interface MerchantStoreRow {
  store_id: string;
  merchant_id: string;
  store_code: string;
  name: string;
  country_code: string;
  currency_code: string;
  is_active: boolean;
}

const HEAD_OFFICE_CODE = 'HO';

/** Every merchant gets a head-office store in their home country/currency for POS and catalog. */
export async function ensureHeadOfficeStore(merchantId: string): Promise<MerchantStoreRow | null> {
  const m = await db.query<{ country_code: string; currency_code: string }>(
    `SELECT country_code, currency_code FROM merchants WHERE merchant_id = $1`,
    [merchantId],
  );
  if (!m.rows.length) return null;
  const { country_code, currency_code } = m.rows[0];

  const existing = await db.query<MerchantStoreRow>(
    `SELECT store_id, merchant_id, store_code, name, country_code, currency_code, is_active
       FROM merchant_stores
      WHERE merchant_id = $1 AND store_code = $2`,
    [merchantId, HEAD_OFFICE_CODE],
  );
  if (existing.rows.length) return existing.rows[0];

  const r = await db.query<MerchantStoreRow>(
    `INSERT INTO merchant_stores (merchant_id, store_code, name, country_code, currency_code)
     VALUES ($1, $2, 'Head office', $3, $4)
     RETURNING store_id, merchant_id, store_code, name, country_code, currency_code, is_active`,
    [merchantId, HEAD_OFFICE_CODE, country_code, currency_code],
  );
  return r.rows[0];
}

function sortStores(stores: MerchantStoreRow[]): MerchantStoreRow[] {
  return [...stores].sort((a, b) => {
    if (a.store_code === HEAD_OFFICE_CODE) return -1;
    if (b.store_code === HEAD_OFFICE_CODE) return 1;
    return a.name.localeCompare(b.name) || a.store_code.localeCompare(b.store_code);
  });
}

async function memberStoreScope(memberId: number): Promise<string | null> {
  const r = await db.query<{ store_scope: string | null }>(
    `SELECT store_scope FROM merchant_members WHERE id = $1`,
    [memberId],
  );
  return r.rows[0]?.store_scope?.trim() || null;
}

export async function listMerchantStores(merchantId: string, memberId?: number): Promise<MerchantStoreRow[]> {
  await ensureHeadOfficeStore(merchantId);
  const scope = memberId != null ? await memberStoreScope(memberId) : null;
  const r = await db.query<MerchantStoreRow>(
    `SELECT store_id, merchant_id, store_code, name, country_code, currency_code, is_active
       FROM merchant_stores
      WHERE merchant_id = $1 AND is_active = TRUE
        AND ($2::text IS NULL OR store_code = $2)
      ORDER BY name, store_code`,
    [merchantId, scope],
  );
  return sortStores(r.rows);
}

export async function resolveStoreForMerchant(
  merchantId: string,
  storeId: string,
  memberId?: number,
): Promise<MerchantStoreRow> {
  const r = await db.query<MerchantStoreRow>(
    `SELECT store_id, merchant_id, store_code, name, country_code, currency_code, is_active
       FROM merchant_stores
      WHERE store_id = $1 AND merchant_id = $2`,
    [storeId, merchantId],
  );
  if (!r.rows.length) throw Object.assign(new Error('Store not found'), { status: 404 });
  const store = r.rows[0];
  if (!store.is_active) throw Object.assign(new Error('Store is inactive'), { status: 400 });

  if (memberId != null) {
    const scope = await memberStoreScope(memberId);
    if (scope && scope !== store.store_code) {
      throw Object.assign(new Error('You are not assigned to this store'), { status: 403 });
    }
  }
  return store;
}

export async function createMerchantStore(
  merchantId: string,
  input: { storeCode: string; name: string; countryCode: string; currencyCode?: string },
): Promise<MerchantStoreRow> {
  const storeCode = input.storeCode.trim();
  const name = input.name.trim();
  if (!storeCode || !name) throw Object.assign(new Error('storeCode and name required'), { status: 400 });

  const expectedCurrency = await currencyForCountry(input.countryCode);
  const currency = (input.currencyCode ?? expectedCurrency).toUpperCase();
  if (currency !== expectedCurrency) {
    throw Object.assign(new Error(`Country ${input.countryCode} uses ${expectedCurrency}, not ${currency}`), { status: 400 });
  }

  const r = await db.query<MerchantStoreRow>(
    `INSERT INTO merchant_stores (merchant_id, store_code, name, country_code, currency_code)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING store_id, merchant_id, store_code, name, country_code, currency_code, is_active`,
    [merchantId, storeCode, name, input.countryCode.toUpperCase(), currency],
  );
  return r.rows[0];
}

export async function updateMerchantStore(
  merchantId: string,
  storeId: string,
  input: { name?: string; countryCode?: string; isActive?: boolean },
): Promise<MerchantStoreRow> {
  const cur = await db.query<MerchantStoreRow>(
    `SELECT store_id, merchant_id, store_code, name, country_code, currency_code, is_active
       FROM merchant_stores WHERE store_id = $1 AND merchant_id = $2`,
    [storeId, merchantId],
  );
  if (!cur.rows.length) throw Object.assign(new Error('Store not found'), { status: 404 });

  let countryCode = cur.rows[0].country_code;
  let currencyCode = cur.rows[0].currency_code;
  if (input.countryCode) {
    countryCode = input.countryCode.toUpperCase();
    currencyCode = await currencyForCountry(countryCode);
  }

  const r = await db.query<MerchantStoreRow>(
    `UPDATE merchant_stores
        SET name = COALESCE($3, name),
            country_code = $4,
            currency_code = $5,
            is_active = COALESCE($6, is_active),
            updated_at = NOW()
      WHERE store_id = $1 AND merchant_id = $2
      RETURNING store_id, merchant_id, store_code, name, country_code, currency_code, is_active`,
    [storeId, merchantId, input.name?.trim() || null, countryCode, currencyCode, input.isActive ?? null],
  );
  return r.rows[0];
}

export interface ProductCorridor {
  countryCode: string;
  currencyCode: string;
}

/** Distinct country+currency pairs from active stores, or merchant org default if none. */
export async function listProductCorridors(merchantId: string): Promise<ProductCorridor[]> {
  await ensureHeadOfficeStore(merchantId);
  const stores = await db.query<{ country_code: string; currency_code: string }>(
    `SELECT DISTINCT country_code, currency_code
       FROM merchant_stores
      WHERE merchant_id = $1 AND is_active = TRUE
      ORDER BY country_code`,
    [merchantId],
  );
  if (stores.rows.length) {
    return stores.rows.map(r => ({ countryCode: r.country_code, currencyCode: r.currency_code }));
  }
  const m = await db.query<{ country_code: string; currency_code: string }>(
    `SELECT country_code, currency_code FROM merchants WHERE merchant_id = $1`,
    [merchantId],
  );
  if (!m.rows.length) throw Object.assign(new Error('Merchant not found'), { status: 404 });
  return [{ countryCode: m.rows[0].country_code, currencyCode: m.rows[0].currency_code }];
}

/** Resolve country + currency for a new/edited product. Currency must match a store corridor. */
export async function resolveProductCorridor(
  merchantId: string,
  currencyCode: string,
  countryCode?: string,
): Promise<ProductCorridor> {
  const corridors = await listProductCorridors(merchantId);
  const cur = currencyCode.toUpperCase();
  const matches = corridors.filter(c => c.currencyCode === cur);
  if (!matches.length) {
    const allowed = [...new Set(corridors.map(c => c.currencyCode))].join(', ');
    throw Object.assign(
      new Error(`Currency ${cur} is not available — add a store in My Business or use: ${allowed}`),
      { status: 400 },
    );
  }
  if (countryCode) {
    const cc = countryCode.toUpperCase();
    const exact = matches.find(c => c.countryCode === cc);
    if (!exact) {
      throw Object.assign(new Error(`No store corridor for ${cur} in ${cc}`), { status: 400 });
    }
    return exact;
  }
  if (matches.length > 1) {
    throw Object.assign(
      new Error(`Multiple countries use ${cur} — specify countryCode`),
      { status: 400 },
    );
  }
  return matches[0];
}
