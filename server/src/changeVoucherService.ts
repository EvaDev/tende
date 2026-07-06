// Merchant-issued change vouchers: debit merchant Vault claim, credit consumer claim.

import crypto from 'crypto';
import { ethers } from 'ethers';
import db from './db.js';
import { currencyDecimals, currencySymbol } from './currencyHelper.js';
import { fromMinorUnits } from './productHelpers.js';
import { resolveStoreForMerchant } from './storeService.js';
import { resolveWalletOrTag } from './walletResolve.js';
import {
  vaultAdminCredit,
  vaultAdminDebit,
  creditFiatWithTreasuryBacking,
  vaultBalanceOf,
} from './treasuryService.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes for QR/link pickup

function secretHash(secret: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(secret));
}

function parseAmountUnits(amount: string | number, currency: string): bigint {
  return ethers.parseUnits(String(amount), currencyDecimals(currency));
}

function formatMoneyMajor(amount: number, currency: string): string {
  const sym = currencySymbol(currency);
  return `${sym}${amount.toFixed(2)}`;
}

async function loadMerchant(merchantId: string) {
  const r = await db.query<{ merchant_id: string; name: string; wallet_address: string | null; currency_code: string }>(
    `SELECT merchant_id, name, wallet_address, currency_code FROM merchants WHERE merchant_id = $1`,
    [merchantId],
  );
  if (!r.rows.length) throw Object.assign(new Error('Merchant not found'), { status: 404 });
  const m = r.rows[0];
  if (!m.wallet_address) throw Object.assign(new Error('Merchant has no wallet address configured'), { status: 400 });
  return m;
}

async function validateProduct(merchantId: string, productId: string | undefined, amountUnits: bigint, currency: string) {
  if (!productId) return null;
  const r = await db.query<{
    product_id: string; name: string; delivery_type: string; currency_code: string;
    is_fixed_price: boolean; price: string | null; min_price: string | null; max_price: string | null;
  }>(
    `SELECT product_id, name, delivery_type, currency_code, is_fixed_price, price, min_price, max_price
       FROM products WHERE product_id = $1 AND merchant_id = $2 AND is_active = TRUE`,
    [productId, merchantId],
  );
  if (!r.rows.length) throw Object.assign(new Error('Product not found'), { status: 404 });
  const p = r.rows[0];
  if (p.delivery_type !== 'VOUCHER') throw Object.assign(new Error('Product must be delivery type VOUCHER'), { status: 400 });
  if (p.currency_code !== currency) throw Object.assign(new Error(`Product currency is ${p.currency_code}`), { status: 400 });

  const amt = Number(ethers.formatUnits(amountUnits, currencyDecimals(currency)));
  const priceMajor = fromMinorUnits(p.price);
  const minMajor = fromMinorUnits(p.min_price);
  const maxMajor = fromMinorUnits(p.max_price);

  // Exact amount only when min, max, and unit price are all the same (true fixed denomination).
  // Otherwise treat unit price as nominal (e.g. R1) and allow any amount within min–max.
  const isExactDenomination = p.is_fixed_price
    && priceMajor != null && minMajor != null && maxMajor != null
    && priceMajor === minMajor && minMajor === maxMajor;
  if (isExactDenomination && amt !== priceMajor) {
    throw Object.assign(new Error(`Amount must be ${formatMoneyMajor(priceMajor, currency)} for this product`), { status: 400 });
  }
  if (minMajor != null && amt < minMajor) {
    throw Object.assign(new Error(`Minimum is ${formatMoneyMajor(minMajor, currency)}`), { status: 400 });
  }
  if (maxMajor != null && amt > maxMajor) {
    throw Object.assign(new Error(`Maximum is ${formatMoneyMajor(maxMajor, currency)}`), { status: 400 });
  }
  return p;
}

async function executeTransfer(
  merchantWallet: string,
  consumerWallet: string,
  amountUnits: bigint,
  currency: string,
): Promise<{ debitTx: string; creditTx: string; mintTx?: string; mintAmount?: bigint; topUpCreditTx?: string }> {
  const bal = await vaultBalanceOf(merchantWallet, currency);
  let mintTx: string | undefined;
  let mintAmount: bigint | undefined;
  let topUpCreditTx: string | undefined;

  // Merchant float short? Top up from unallocated treasury backing in the vault,
  // minting TTMW/TTZA only for the remainder (retailer issuance / Pep float).
  if (bal < amountUnits) {
    const shortfall = amountUnits - bal;
    const topUp = await creditFiatWithTreasuryBacking(merchantWallet, shortfall, currency);
    mintTx = topUp.mintTx;
    mintAmount = topUp.mintAmount;
    topUpCreditTx = topUp.creditTx;
  }

  const debitTx = await vaultAdminDebit(merchantWallet, amountUnits, currency);
  const creditTx = await vaultAdminCredit(consumerWallet, amountUnits, currency);
  return { debitTx, creditTx, mintTx, mintAmount, topUpCreditTx };
}

function changeVoucherMintReference(storeNumber: string, voucherId: string): string {
  const store = (storeNumber || 'STORE').trim();
  return `${store}/CV-${voucherId}`;
}

/** Links a treasury mint (merchant float top-up) to store + change voucher for Mint & Burn reporting. */
async function recordChangeVoucherMintRef(p: {
  storeNumber: string;
  voucherId: string;
  merchantWallet: string;
  mintTx: string;
  topUpCreditTx: string;
  mintAmount: bigint;
  currency: string;
}): Promise<void> {
  const reference = changeVoucherMintReference(p.storeNumber, p.voucherId);
  await db.query(
    `INSERT INTO deposit_references (reference, kind, source, wallet, amount, currency, mint_tx, credit_tx)
     VALUES ($1,'change_voucher','merchant',$2,$3,$4,$5,$6)`,
    [
      reference,
      p.merchantWallet.toLowerCase(),
      p.mintAmount.toString(),
      p.currency.toUpperCase(),
      p.mintTx,
      p.topUpCreditTx,
    ],
  );
  await db.query(`UPDATE change_vouchers SET mint_tx = $2 WHERE voucher_id = $1`, [p.voucherId, p.mintTx]);
}

export interface PrepareChangeVoucherInput {
  merchantId: string;
  memberId?: number;
  amount: string;
  productId?: string;
  storeId: string;
  tillNumber?: string;
}

async function resolveStoreContext(p: PrepareChangeVoucherInput) {
  if (!p.storeId?.trim()) throw Object.assign(new Error('storeId required — select a store in POS'), { status: 400 });
  const store = await resolveStoreForMerchant(p.merchantId, p.storeId.trim(), p.memberId);
  return store;
}

export async function prepareChangeVoucher(p: PrepareChangeVoucherInput) {
  const merchant = await loadMerchant(p.merchantId);
  const store = await resolveStoreContext(p);
  const currency = store.currency_code.toUpperCase();
  const amountUnits = parseAmountUnits(p.amount, currency);
  if (amountUnits <= 0n) throw Object.assign(new Error('Amount must be positive'), { status: 400 });
  await validateProduct(p.merchantId, p.productId, amountUnits, currency);

  const secret = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
  const r = await db.query<{ voucher_id: string }>(
    `INSERT INTO change_vouchers
       (merchant_id, product_id, amount, currency, delivery_mode, claim_secret_hash,
        store_id, store_number, till_number, issued_by_member_id, expires_at)
     VALUES ($1,$2,$3,$4,'qr',$5,$6,$7,$8,$9,$10)
     RETURNING voucher_id`,
    [
      p.merchantId, p.productId ?? null, amountUnits.toString(), currency,
      secretHash(secret), store.store_id, store.store_code, p.tillNumber ?? null,
      p.memberId ?? null, expiresAt.toISOString(),
    ],
  );
  const voucherId = r.rows[0].voucher_id;
  const dec = currencyDecimals(currency);
  const qrPayload = JSON.stringify({
    imali: 1,
    type: 'change',
    cid: voucherId,
    s: secret,
    amt: ethers.formatUnits(amountUnits, dec),
    cur: currency,
    n: merchant.name,
    mid: merchant.merchant_id,
    sid: store.store_id,
    store: store.store_code,
    till: p.tillNumber,
  });
  return {
    voucherId,
    secret,
    amount: ethers.formatUnits(amountUnits, dec),
    currency,
    merchantName: merchant.name,
    expiresAt: expiresAt.toISOString(),
    qrPayload,
    /** Deep link for the consumer app (hash router). Cashier can share via WhatsApp. */
    consumerLink: `#/receive?c=${secret}`,
  };
}

export interface SendChangeVoucherInput extends PrepareChangeVoucherInput {
  tag: string;
}

export async function sendChangeVoucherToTag(p: SendChangeVoucherInput) {
  const merchant = await loadMerchant(p.merchantId);
  const store = await resolveStoreContext(p);
  const currency = store.currency_code.toUpperCase();
  const amountUnits = parseAmountUnits(p.amount, currency);
  if (amountUnits <= 0n) throw Object.assign(new Error('Amount must be positive'), { status: 400 });
  await validateProduct(p.merchantId, p.productId, amountUnits, currency);

  const recipientWallet = await resolveWalletOrTag(p.tag);
  const tag = p.tag.replace(/^@/, '').toLowerCase().split('.')[0];
  const { debitTx, creditTx, mintTx, mintAmount, topUpCreditTx } =
    await executeTransfer(merchant.wallet_address!, recipientWallet, amountUnits, currency);

  const secret = crypto.randomBytes(16).toString('hex');
  const r = await db.query<{ voucher_id: string }>(
    `INSERT INTO change_vouchers
       (merchant_id, product_id, amount, currency, status, delivery_mode,
        recipient_wallet, recipient_tag, claim_secret_hash,
        store_id, store_number, till_number, issued_by_member_id,
        debit_tx, credit_tx, mint_tx, expires_at, claimed_at)
     VALUES ($1,$2,$3,$4,'claimed','tag',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     RETURNING voucher_id`,
    [
      p.merchantId, p.productId ?? null, amountUnits.toString(), currency,
      recipientWallet.toLowerCase(), tag, secretHash(secret),
      store.store_id, store.store_code, p.tillNumber ?? null, p.memberId ?? null,
      debitTx, creditTx, mintTx ?? null,
    ],
  );
  const voucherId = r.rows[0].voucher_id;
  if (mintTx && mintAmount && topUpCreditTx) {
    await recordChangeVoucherMintRef({
      storeNumber: store.store_code,
      voucherId,
      merchantWallet: merchant.wallet_address!,
      mintTx,
      topUpCreditTx,
      mintAmount,
      currency,
    });
  }
  const dec = currencyDecimals(currency);
  return {
    voucherId: r.rows[0].voucher_id,
    recipientWallet,
    recipientTag: tag,
    amount: ethers.formatUnits(amountUnits, dec),
    currency,
    debitTx,
    creditTx,
  };
}

export async function getChangeVoucherSummary(secret: string) {
  const r = await db.query<{
    voucher_id: string; status: string; amount: string; currency: string;
    expires_at: string; merchant_name: string;
  }>(
    `SELECT v.voucher_id, v.status, v.amount, v.currency, v.expires_at, m.name AS merchant_name
       FROM change_vouchers v
       JOIN merchants m ON m.merchant_id = v.merchant_id
      WHERE v.claim_secret_hash = $1`,
    [secretHash(secret)],
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const dec = row.currency === 'USDC' ? 6 : 2;
  return {
    voucherId: row.voucher_id,
    status: row.status,
    amount: ethers.formatUnits(row.amount, dec),
    currency: row.currency,
    merchantName: row.merchant_name,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() < Date.now(),
  };
}

export async function redeemChangeVoucher(secret: string, consumerWallet: string) {
  const hash = secretHash(secret);
  const r = await db.query<{
    voucher_id: string; merchant_id: string; amount: string; currency: string;
    status: string; expires_at: string; wallet_address: string; store_number: string | null;
  }>(
    `SELECT v.voucher_id, v.merchant_id, v.amount, v.currency, v.status, v.expires_at,
            v.store_number, m.wallet_address
       FROM change_vouchers v
       JOIN merchants m ON m.merchant_id = v.merchant_id
      WHERE v.claim_secret_hash = $1
      FOR UPDATE`,
    [hash],
  );
  if (!r.rows.length) throw Object.assign(new Error('Change voucher not found'), { status: 404 });
  const v = r.rows[0];
  if (v.status === 'claimed') throw Object.assign(new Error('This change voucher has already been claimed'), { status: 409 });
  if (v.status !== 'pending') throw Object.assign(new Error('This change voucher is no longer valid'), { status: 400 });
  if (new Date(v.expires_at).getTime() < Date.now()) {
    await db.query(`UPDATE change_vouchers SET status = 'expired' WHERE voucher_id = $1`, [v.voucher_id]);
    throw Object.assign(new Error('This change voucher has expired — ask the cashier for a new one'), { status: 410 });
  }
  if (!v.wallet_address) throw Object.assign(new Error('Merchant wallet not configured'), { status: 500 });

  const amountUnits = BigInt(v.amount);
  const { debitTx, creditTx, mintTx, mintAmount, topUpCreditTx } =
    await executeTransfer(v.wallet_address, consumerWallet, amountUnits, v.currency);

  await db.query(
    `UPDATE change_vouchers
        SET status = 'claimed', recipient_wallet = $2, debit_tx = $3, credit_tx = $4,
            mint_tx = COALESCE($5, mint_tx), claimed_at = NOW()
      WHERE voucher_id = $1`,
    [v.voucher_id, consumerWallet.toLowerCase(), debitTx, creditTx, mintTx ?? null],
  );

  if (mintTx && mintAmount && topUpCreditTx) {
    await recordChangeVoucherMintRef({
      storeNumber: v.store_number ?? 'STORE',
      voucherId: v.voucher_id,
      merchantWallet: v.wallet_address,
      mintTx,
      topUpCreditTx,
      mintAmount,
      currency: v.currency,
    });
  }

  const dec = v.currency === 'USDC' ? 6 : 2;
  return {
    voucherId: v.voucher_id,
    amount: ethers.formatUnits(amountUnits, dec),
    currency: v.currency,
    debitTx,
    creditTx,
  };
}
