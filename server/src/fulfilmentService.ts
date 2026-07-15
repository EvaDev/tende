// src/fulfilmentService.ts
// After a POS / product purchase lands in platform escrow, call the product's
// fulfilment API. On success: escrow → merchant. On failure: escrow → consumer.
//
// The mock API delay (~30s) is intentionally visible in the purchase UI. On-chain
// release can take longer on Sepolia, so we record the API outcome first (so the
// client can finish), then release funds in the background.

import db from './db.js';
import { ethers } from 'ethers';
import { escrowAddress } from './escrowService.js';
import { vaultAdminCredit, vaultAdminDebit } from './treasuryService.js';
import { defaultFulfilmentUrl } from './productCatalogService.js';

const FULFIL_TIMEOUT_MS = 45_000;

interface SaleRow {
  sale_id: string;
  merchant_id: string | null;
  merchant_wallet: string;
  consumer_wallet: string | null;
  amount: string;
  currency: string;
  status: string;
  fulfilment_status: string | null;
  fulfilment_url: string | null;
  items: unknown;
}

export function mockFulfilmentOutcome(): { success: boolean } {
  return { success: Math.random() < 0.5 };
}

export async function resolveFulfilmentUrl(opts: {
  productId?: string | null;
  merchantId?: string | null;
}): Promise<string> {
  if (opts.productId) {
    const r = await db.query<{ fulfilment_url: string | null }>(
      `SELECT fulfilment_url FROM products WHERE product_id = $1`,
      [opts.productId],
    );
    if (r.rows[0]?.fulfilment_url) return r.rows[0].fulfilment_url;
  }
  if (opts.merchantId) {
    const r = await db.query<{ fulfilment_url: string | null }>(
      `SELECT fulfilment_url FROM products
        WHERE merchant_id = $1 AND fulfilment_url IS NOT NULL AND is_active = TRUE
        ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [opts.merchantId],
    );
    if (r.rows[0]?.fulfilment_url) return r.rows[0].fulfilment_url;
  }
  return defaultFulfilmentUrl();
}

async function callFulfilmentApi(url: string, body: Record<string, unknown>): Promise<{ success: boolean; detail?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FULFIL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* non-json */ }

    if (!res.ok) {
      return { success: false, detail: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    if (typeof json.success === 'boolean') return { success: json.success, detail: text.slice(0, 500) };
    if (json.status === 'ok' || json.status === 'success') return { success: true, detail: text.slice(0, 500) };
    if (json.status === 'failed' || json.status === 'error') return { success: false, detail: text.slice(0, 500) };
    return { success: true, detail: text.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

async function releaseEscrow(toWallet: string, amountUnits: bigint, currency: string): Promise<string> {
  await vaultAdminDebit(escrowAddress(), amountUnits, currency);
  return vaultAdminCredit(toWallet, amountUnits, currency);
}

async function releaseEscrowInBackground(saleId: string | number, toWallet: string, amountUnits: bigint, currency: string, paidStatus: 'paid' | 'refunded'): Promise<void> {
  try {
    const releaseTx = await releaseEscrow(toWallet, amountUnits, currency);
    await db.query(
      `UPDATE merchant_sales SET status = $2, release_tx = $3
       WHERE sale_id = $1 AND status = 'pending_fulfilment'`,
      [saleId, paidStatus, releaseTx],
    );
  } catch (e) {
    console.error('[releaseEscrowInBackground]', saleId, (e as Error).message);
    await db.query(
      `UPDATE merchant_sales SET fulfilment_error = COALESCE(fulfilment_error, '') || $2
       WHERE sale_id = $1`,
      [saleId, ` | release failed: ${(e as Error).message}`],
    );
  }
}

/// Process a pending_fulfilment sale. Records the fulfilment API outcome promptly
/// so the consumer UI can finish (~mock delay), then releases escrow async.
export async function processSaleFulfilment(saleId: string | number): Promise<{
  status: 'paid' | 'refunded' | 'skipped';
  releaseTx?: string;
  error?: string;
}> {
  const r = await db.query<SaleRow>(
    `SELECT sale_id::text, merchant_id, merchant_wallet, consumer_wallet,
            amount::text, currency, status, fulfilment_status, fulfilment_url, items
       FROM merchant_sales WHERE sale_id = $1`,
    [saleId],
  );
  const sale = r.rows[0];
  if (!sale) throw new Error('Sale not found');
  if (sale.status !== 'pending_fulfilment') {
    return { status: 'skipped', error: `Sale already ${sale.status}` };
  }
  // Already have an API outcome — only the on-chain leg may still be running.
  if (sale.fulfilment_status === 'success' || sale.fulfilment_status === 'failed') {
    return { status: 'skipped', error: `Fulfilment API already ${sale.fulfilment_status}` };
  }

  const currency = sale.currency.toUpperCase();
  const decimals = currency === 'USDC' ? 6 : 2;
  const amountUnits = ethers.parseUnits(String(Number(sale.amount).toFixed(decimals)), decimals);
  const fulfilUrl = sale.fulfilment_url || defaultFulfilmentUrl();

  await db.query(
    `UPDATE merchant_sales SET fulfilment_status = 'pending'
     WHERE sale_id = $1 AND status = 'pending_fulfilment'`,
    [saleId],
  );

  let outcome: { success: boolean; detail?: string };
  try {
    outcome = await callFulfilmentApi(fulfilUrl, {
      saleId: sale.sale_id,
      merchantId: sale.merchant_id,
      merchantWallet: sale.merchant_wallet,
      consumerWallet: sale.consumer_wallet,
      amount: sale.amount,
      currency,
      items: sale.items,
    });
  } catch (e) {
    outcome = { success: false, detail: (e as Error).message };
  }

  if (outcome.success) {
    // Publish API success immediately so the client can leave the ~30s wait.
    await db.query(
      `UPDATE merchant_sales SET fulfilment_status = 'success', fulfilment_error = NULL
       WHERE sale_id = $1 AND status = 'pending_fulfilment'`,
      [saleId],
    );
    setImmediate(() => {
      void releaseEscrowInBackground(saleId, sale.merchant_wallet, amountUnits, currency, 'paid');
    });
    return { status: 'paid' };
  }

  if (!sale.consumer_wallet) {
    await db.query(
      `UPDATE merchant_sales SET
         fulfilment_status = 'failed',
         fulfilment_error = $2
       WHERE sale_id = $1`,
      [saleId, outcome.detail ?? 'Fulfilment failed (no consumer wallet for refund)'],
    );
    return { status: 'skipped', error: outcome.detail };
  }

  await db.query(
    `UPDATE merchant_sales SET
       fulfilment_status = 'failed',
       fulfilment_error = $2
     WHERE sale_id = $1 AND status = 'pending_fulfilment'`,
    [saleId, outcome.detail ?? 'Fulfilment failed'],
  );
  setImmediate(() => {
    void releaseEscrowInBackground(saleId, sale.consumer_wallet!, amountUnits, currency, 'refunded');
  });
  return { status: 'refunded', error: outcome.detail };
}

/// Kick off fulfilment without blocking the payment response.
export function enqueueSaleFulfilment(saleId: string | number): void {
  setImmediate(() => {
    processSaleFulfilment(saleId).catch(err => {
      console.error('[enqueueSaleFulfilment]', saleId, (err as Error).message);
    });
  });
}
