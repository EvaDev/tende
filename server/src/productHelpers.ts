// Shared product field parsing for merchant self-service routes.
// Prices are stored in minor units (cents); the API accepts major-unit decimals from the UI.

const DELIVERY_TYPES = new Set(['DIRECT', 'VOUCHER', 'PHYSICAL', 'VIRTUAL']);

export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

export function fromMinorUnits(minor: number | string | null): number | null {
  if (minor == null || minor === '') return null;
  return Number(minor) / 100;
}

export interface ProductBody {
  name?: string;
  description?: string | null;
  deliveryType?: string;
  isFixedPrice?: boolean;
  unitPrice?: number | string | null;
  minPrice?: number | string | null;
  maxPrice?: number | string | null;
  incursVat?: boolean;
  validityDays?: number | string | null;
  isActive?: boolean;
  barcode?: string | null;
  fulfilmentUrl?: string | null;
}

export function parseProductBody(body: ProductBody, partial: boolean): {
  fields: Record<string, unknown>;
  error?: string;
} {
  const fields: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (!String(body.name).trim()) return { fields, error: 'Product name is required' };
    fields.name = String(body.name).trim();
  } else if (!partial) {
    return { fields, error: 'Product name is required' };
  }

  if (body.description !== undefined) {
    fields.description = body.description ? String(body.description).trim() : null;
  }

  if (body.deliveryType !== undefined) {
    const dt = String(body.deliveryType).toUpperCase();
    if (!DELIVERY_TYPES.has(dt)) return { fields, error: 'deliveryType must be DIRECT, VIRTUAL, PHYSICAL, or VOUCHER' };
    fields.delivery_type = dt;
  } else if (!partial) {
    fields.delivery_type = 'DIRECT';
  }

  const isFixed = body.isFixedPrice !== undefined ? !!body.isFixedPrice : !partial ? true : undefined;
  if (isFixed !== undefined) fields.is_fixed_price = isFixed;

  const fixed = isFixed ?? true;

  if (body.unitPrice !== undefined && body.unitPrice !== null && body.unitPrice !== '') {
    const major = Number(body.unitPrice);
    if (!(major > 0)) return { fields, error: 'Unit price must be positive' };
    const cents = toMinorUnits(major);
    fields.price = cents;
    if (fixed && body.minPrice === undefined) fields.min_price = cents;
    if (fixed && body.maxPrice === undefined) fields.max_price = cents;
  }

  if (body.minPrice !== undefined) {
    if (body.minPrice === null || body.minPrice === '') fields.min_price = null;
    else {
      const major = Number(body.minPrice);
      if (!(major > 0)) return { fields, error: 'Min price must be positive' };
      fields.min_price = toMinorUnits(major);
    }
  }

  if (body.maxPrice !== undefined) {
    if (body.maxPrice === null || body.maxPrice === '') fields.max_price = null;
    else {
      const major = Number(body.maxPrice);
      if (!(major > 0)) return { fields, error: 'Max price must be positive' };
      fields.max_price = toMinorUnits(major);
    }
  }

  if (!partial) {
    const fp = fields.is_fixed_price as boolean;
    if (fp) {
      if (fields.price == null) return { fields, error: 'Fixed-price products need a unit price' };
    } else {
      if (fields.min_price == null || fields.max_price == null) {
        return { fields, error: 'Variable-price products need min and max amounts' };
      }
      if (Number(fields.min_price) > Number(fields.max_price)) {
        return { fields, error: 'Min price cannot exceed max price' };
      }
      fields.price = null;
    }
  } else if (fields.is_fixed_price === false) {
    fields.price = null;
  }

  if (body.incursVat !== undefined) fields.incurs_vat = !!body.incursVat;
  else if (!partial) fields.incurs_vat = true;

  if (body.validityDays !== undefined) {
    if (body.validityDays === null || body.validityDays === '') fields.validity_days = null;
    else {
      const days = Number(body.validityDays);
      if (!Number.isInteger(days) || days < 0) return { fields, error: 'Validity days must be a non-negative integer' };
      fields.validity_days = days;
    }
  }

  if (body.isActive !== undefined) fields.is_active = !!body.isActive;

  if (body.barcode !== undefined) {
    fields.barcode = body.barcode ? String(body.barcode).trim() : null;
  }

  if (body.fulfilmentUrl !== undefined) {
    fields.fulfilment_url = body.fulfilmentUrl ? String(body.fulfilmentUrl).trim() : null;
  }

  return { fields };
}

export const PRODUCT_SELECT = `
  product_id AS id, name, description, delivery_type, is_fixed_price,
  price, min_price, max_price, incurs_vat, validity_days,
  country_code, currency_code, icon_id, is_active, created_at,
  barcode, fulfilment_url, source, external_product_id, supplier_api_code
`;

export function mapProductRow(row: Record<string, unknown>) {
  return {
    ...row,
    price: fromMinorUnits(row.price as string | null),
    min_price: fromMinorUnits(row.min_price as string | null),
    max_price: fromMinorUnits(row.max_price as string | null),
  };
}
