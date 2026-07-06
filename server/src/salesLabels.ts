// Labels for off-premise (consumer app / catalog) sales — no POS store or till captured.

export const WEB_SALE_STORE = 'Head office';
export const WEB_SALE_TILL  = 'Web Sale';

export function resolveStoreTill(
  store?: string | null,
  till?: string | null,
): { store: string; till: string } {
  const s = store?.trim();
  const t = till?.trim();
  if (s && t) return { store: s, till: t };
  if (s) return { store: s, till: t || WEB_SALE_TILL };
  if (t) return { store: WEB_SALE_STORE, till: t };
  return { store: WEB_SALE_STORE, till: WEB_SALE_TILL };
}

/** SQL expressions — keep sales rollups aligned with resolveStoreTill(). */
export const SQL_STORE_LABEL = `COALESCE(NULLIF(TRIM(store_number), ''), '${WEB_SALE_STORE}')`;
export const SQL_TILL_LABEL  = `COALESCE(NULLIF(TRIM(till_number), ''), '${WEB_SALE_TILL}')`;
