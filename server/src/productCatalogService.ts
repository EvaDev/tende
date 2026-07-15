// src/productCatalogService.ts
// Sync a merchant's catalogue from an external product listing API.
// First adapter: Flash PIM (`/api/PimProducts/{channelId}`). Products are upserted
// into our `products` table (source='api') so POS / barcode / fulfilment stay local.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import config from './config.js';
import { toMinorUnits } from './productHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COUNTRY_CURRENCY: Record<string, string> = {
  ZA: 'ZAR', MW: 'MWK', ZW: 'ZWG', US: 'USD', GB: 'GBP',
};

export type CatalogAdapter = 'flash_pim';

export interface CatalogConfig {
  url: string | null;
  adapter: CatalogAdapter | null;
  syncedAt: string | null;
}

export interface SyncResult {
  upserted: number;
  deactivated: number;
  skipped: number;
  totalRemote: number;
}

interface MappedProduct {
  externalProductId: string;
  name: string;
  description: string | null;
  deliveryType: 'DIRECT' | 'VOUCHER' | 'PHYSICAL' | 'VIRTUAL';
  countryCode: string;
  currencyCode: string;
  isFixedPrice: boolean;
  priceMinor: number | null;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  category: string | null;
  brand: string | null;
  barcode: string | null;
  supplierApiCode: string | null;
  isActive: boolean;
}

function defaultFulfilmentUrl(): string {
  return `${config.server.publicApiBase.replace(/\/$/, '')}/api/mock/fulfil`;
}

function deliveryFromCategory(category: string | null | undefined): MappedProduct['deliveryType'] {
  const c = (category ?? '').toLowerCase();
  // Flash eVoucher / PIN products are buyable digitally (consumer Buy screen),
  // not POS change-vouchers — map to VIRTUAL.
  if (c.includes('voucher') || c.includes('evoucher')) return 'VIRTUAL';
  if (c.includes('airtime') || c.includes('data') || c.includes('electric')) return 'VIRTUAL';
  return 'VIRTUAL';
}

function pickIdentifier(
  ids: { type?: string; value?: string }[] | null | undefined,
  prefer: string,
): string | null {
  if (!Array.isArray(ids)) return null;
  const hit = ids.find(i => (i.type ?? '').toLowerCase().includes(prefer.toLowerCase()));
  if (hit?.value) return String(hit.value);
  return ids[0]?.value ? String(ids[0].value) : null;
}

function parseMajor(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/// Flash PIM → our product row shape.
export function mapFlashPimItem(item: Record<string, unknown>): MappedProduct | null {
  const pimId = item.pimId;
  if (pimId == null) return null;
  const base = (item.baseProduct ?? {}) as Record<string, unknown>;
  const supplier = (item.supplierProduct ?? {}) as Record<string, unknown>;
  const country = (supplier.country ?? {}) as Record<string, unknown>;
  const countryCode = String(country.code ?? 'ZA').toUpperCase().slice(0, 3);
  const currencyCode = COUNTRY_CURRENCY[countryCode] ?? 'ZAR';

  const supplierFixed = parseMajor(supplier.fixedValue);
  const baseFixed = parseMajor(base.fixedValue);
  const fixedMajor = supplierFixed ?? baseFixed;

  const rangeMin = parseMajor(supplier.rangeMinimumValue) ?? parseMajor(base.rangeMinimumValue);
  const rangeMax = parseMajor(supplier.rangeMaximumValue) ?? parseMajor(base.rangeMaximumValue);

  // Prefer an explicit supplier/base fixedValue; otherwise use the range as variable price.
  let isFixed: boolean;
  let priceMinor: number | null;
  let minPriceMinor: number | null;
  let maxPriceMinor: number | null;

  if (supplier.fixedValue != null && supplierFixed != null) {
    isFixed = true;
    priceMinor = toMinorUnits(supplierFixed);
    minPriceMinor = priceMinor;
    maxPriceMinor = priceMinor;
  } else if (rangeMin != null && rangeMax != null) {
    isFixed = false;
    priceMinor = null;
    minPriceMinor = toMinorUnits(rangeMin);
    maxPriceMinor = toMinorUnits(rangeMax);
  } else if (fixedMajor != null) {
    isFixed = true;
    priceMinor = toMinorUnits(fixedMajor);
    minPriceMinor = priceMinor;
    maxPriceMinor = priceMinor;
  } else {
    return null;
  }

  const category = base.productCategory != null ? String(base.productCategory) : null;
  const brand = base.brand != null ? String(base.brand) : null;
  const baseName = String(base.name ?? 'Product').trim() || 'Product';
  const name = isFixed && fixedMajor != null
    ? `${baseName} ${fixedMajor}`
    : baseName;

  const ids = supplier.productIdentifiers as { type?: string; value?: string }[] | undefined;
  const barcode = pickIdentifier(ids, 'Barcode');
  const supplierCode = pickIdentifier(ids, 'Supplier Product Code');

  const isDeleted = item.isDeleted === true;
  const isActive = item.isActive !== false && !isDeleted;

  return {
    externalProductId: String(pimId),
    name,
    description: [supplier.supplier, category].filter(Boolean).join(' · ') || null,
    deliveryType: deliveryFromCategory(category),
    countryCode,
    currencyCode,
    isFixedPrice: isFixed,
    priceMinor,
    minPriceMinor,
    maxPriceMinor,
    category,
    brand,
    barcode,
    supplierApiCode: supplierCode,
    isActive,
  };
}

export function parseFlashPimPayload(payload: unknown): MappedProduct[] {
  const root = payload as { data?: { items?: unknown[] }; items?: unknown[] };
  const items = root?.data?.items ?? root?.items ?? (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(items)) return [];
  const out: MappedProduct[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const mapped = mapFlashPimItem(raw as Record<string, unknown>);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function fetchCatalogJson(url: string): Promise<unknown> {
  // Demo / offline: our own mock fixture endpoint or file://
  if (url.startsWith('file://')) {
    const filePath = url.slice('file://'.length);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Catalog API returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function loadFlashPimFixture(): unknown {
  const fixture = path.resolve(__dirname, '../fixtures/flash-pim-channel-1.json');
  return JSON.parse(fs.readFileSync(fixture, 'utf8'));
}

export async function getCatalogConfig(merchantId: string): Promise<CatalogConfig> {
  const r = await db.query<{
    catalog_api_url: string | null;
    catalog_api_adapter: string | null;
    catalog_synced_at: Date | null;
  }>(
    `SELECT catalog_api_url, catalog_api_adapter, catalog_synced_at
       FROM merchants WHERE merchant_id = $1`,
    [merchantId],
  );
  const row = r.rows[0];
  if (!row) throw Object.assign(new Error('Merchant not found'), { status: 404 });
  return {
    url: row.catalog_api_url,
    adapter: (row.catalog_api_adapter as CatalogAdapter | null) ?? null,
    syncedAt: row.catalog_synced_at ? new Date(row.catalog_synced_at).toISOString() : null,
  };
}

export async function saveCatalogConfig(
  merchantId: string,
  input: { url?: string | null; adapter?: string | null },
): Promise<CatalogConfig> {
  const updates: string[] = [];
  const vals: unknown[] = [merchantId];

  if (input.url !== undefined) {
    vals.push(input.url ? String(input.url).trim() : null);
    updates.push(`catalog_api_url = $${vals.length}`);
  }
  if (input.adapter !== undefined) {
    const adapter = input.adapter ? String(input.adapter).trim() : null;
    if (adapter && adapter !== 'flash_pim') {
      throw Object.assign(new Error('adapter must be flash_pim (only adapter available)'), { status: 400 });
    }
    vals.push(adapter);
    updates.push(`catalog_api_adapter = $${vals.length}`);
  }
  if (!updates.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });

  await db.query(
    `UPDATE merchants SET ${updates.join(', ')}, updated_at = NOW() WHERE merchant_id = $1`,
    vals,
  );
  return getCatalogConfig(merchantId);
}

export async function syncMerchantCatalog(merchantId: string): Promise<SyncResult> {
  const cfg = await getCatalogConfig(merchantId);
  if (!cfg.url) throw Object.assign(new Error('Set a catalogue API URL before syncing'), { status: 400 });
  const adapter = cfg.adapter ?? 'flash_pim';
  if (adapter !== 'flash_pim') {
    throw Object.assign(new Error(`Unsupported adapter: ${adapter}`), { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await fetchCatalogJson(cfg.url);
  } catch (e) {
    // Fall back to bundled fixture when the live URL is unreachable (e.g. VPN).
    if (cfg.url.includes('flash.co.za') || cfg.url.includes('/api/mock/catalog/flash-pim')) {
      console.warn('[syncMerchantCatalog] live fetch failed, using fixture:', (e as Error).message);
      payload = loadFlashPimFixture();
    } else {
      throw Object.assign(new Error(`Could not fetch catalogue: ${(e as Error).message}`), { status: 502 });
    }
  }

  // Built-in mock endpoint returns the fixture via HTTP; parse either way.
  const mapped = parseFlashPimPayload(payload);
  const fulfilmentUrl = defaultFulfilmentUrl();

  let upserted = 0;
  let skipped = 0;
  const seenIds: string[] = [];

  for (const p of mapped) {
    seenIds.push(p.externalProductId);
    if (p.minPriceMinor == null || p.maxPriceMinor == null) {
      if (!p.isFixedPrice || p.priceMinor == null) { skipped++; continue; }
    }

    const existing = await db.query<{ product_id: string; source: string }>(
      `SELECT product_id, source FROM products
        WHERE merchant_id = $1 AND external_product_id = $2`,
      [merchantId, p.externalProductId],
    );

    if (existing.rows[0]?.source === 'manual') {
      skipped++;
      continue; // never overwrite hand-edited rows with the same external id
    }

    if (existing.rows.length) {
      await db.query(
        `UPDATE products SET
           name = $3, description = $4, delivery_type = $5,
           country_code = $6, currency_code = $7,
           is_fixed_price = $8, price = $9, min_price = $10, max_price = $11,
           category = $12, brand = $13, barcode = $14, supplier_api_code = $15,
           fulfilment_url = COALESCE(fulfilment_url, $16),
           is_active = $17, source = 'api', updated_at = NOW()
         WHERE product_id = $1 AND merchant_id = $2`,
        [
          existing.rows[0].product_id, merchantId,
          p.name, p.description, p.deliveryType,
          p.countryCode, p.currencyCode,
          p.isFixedPrice, p.priceMinor, p.minPriceMinor, p.maxPriceMinor,
          p.category, p.brand, p.barcode, p.supplierApiCode,
          fulfilmentUrl, p.isActive,
        ],
      );
    } else {
      await db.query(
        `INSERT INTO products (
           merchant_id, country_code, currency_code, name, description, delivery_type,
           is_fixed_price, price, min_price, max_price, incurs_vat,
           external_product_id, supplier_api_code, category, brand, barcode, fulfilment_url,
           source, is_active
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,$13,$14,$15,$16,'api',$17
         )`,
        [
          merchantId, p.countryCode, p.currencyCode, p.name, p.description, p.deliveryType,
          p.isFixedPrice, p.priceMinor, p.minPriceMinor, p.maxPriceMinor,
          p.externalProductId, p.supplierApiCode, p.category, p.brand, p.barcode, fulfilmentUrl,
          p.isActive,
        ],
      );
    }
    upserted++;
  }

  // Deactivate API products missing from this feed (keep history / sales links).
  let deactivated = 0;
  if (seenIds.length) {
    const r = await db.query(
      `UPDATE products SET is_active = FALSE, updated_at = NOW()
        WHERE merchant_id = $1 AND source = 'api'
          AND is_active = TRUE
          AND (external_product_id IS NULL OR external_product_id <> ALL($2::text[]))
        RETURNING product_id`,
      [merchantId, seenIds],
    );
    deactivated = r.rowCount ?? 0;
  }

  await db.query(
    `UPDATE merchants SET catalog_synced_at = NOW(), updated_at = NOW() WHERE merchant_id = $1`,
    [merchantId],
  );

  return { upserted, deactivated, skipped, totalRemote: mapped.length };
}

export { defaultFulfilmentUrl };
