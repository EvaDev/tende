// src/consumer.routes.ts
// Consumer-facing API routes. All routes require a valid JWT (requireAuth).
//
// GET  /api/consumer/me           — profile: wallet, KYC level, ENS, feature gates
// GET  /api/consumer/balance      — live on-chain token balances
// GET  /api/consumer/transactions — transaction history from onchain_events
// GET  /api/consumer/kyc          — KYC level + all spending limits

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import config from './config.js';
import db     from './db.js';
import { getAppDisplayName } from './appBrand.js';
import { requireAuth } from './auth.middleware.js';
import type { KycLevelRow } from './types.js';
import { fromMinorUnits } from './productHelpers.js';
import { spendCurrencyForCountry } from './currencyHelper.js';
import { resolveStoreTill } from './salesLabels.js';
import { executeConversion } from './conversionService.js';
import { resolveWalletOrTag } from './walletResolve.js';

const router = express.Router();
router.use(requireAuth);

const ERC20_BALANCE_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

// ── GET /api/consumer/me ──────────────────────────────────────────────────────

router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await db.query(
      `SELECT
         c.consumer_id, c.wallet_address, c.country_code, c.ens_subdomain,
         c.global_consumer_id, c.source_system, c.kyc_level_id, c.display_name, c.mobile_number,
         (c.display_name_hash IS NOT NULL) AS has_name_hash,
         (c.mobile_hash IS NOT NULL)       AS has_mobile_hash,
         k.level_name, k.allows_usd_savings, k.allows_remittance, k.allows_merchant_spend
       FROM consumers c
       LEFT JOIN kyc_levels k ON k.level_id = c.kyc_level_id
       WHERE c.consumer_id = $1`,
      [req.consumer!.consumerId],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: 'Consumer not found' });
      return;
    }

    const c = result.rows[0];
    res.json({
      consumerId:       c.consumer_id,
      globalConsumerId: c.global_consumer_id != null ? Number(c.global_consumer_id) : null,
      walletAddress:    c.wallet_address,
      countryCode:      c.country_code,
      ensSubdomain:     c.ens_subdomain,
      sourceSystem:     c.source_system,
      displayName:      c.display_name ?? null,
      mobileNumber:     c.mobile_number ?? null,
      // Whether name/mobile are on file at all (plaintext kept only for POC).
      hasName:          c.display_name != null || c.has_name_hash === true,
      hasMobile:        c.mobile_number != null || c.has_mobile_hash === true,
      kyc: {
        levelId:             c.kyc_level_id,
        levelName:           c.level_name,
        allowsUsdSavings:    c.allows_usd_savings,
        allowsRemittance:    c.allows_remittance,
        allowsMerchantSpend: c.allows_merchant_spend,
      },
    });
  } catch (err) {
    console.error('[GET /api/consumer/me]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/consumer/products ────────────────────────────────────────────────
// Browseable catalogue for the Buy screen: active products from active merchants
// in the consumer's country. In-person (DIRECT) products are POS-only — excluded.
router.get('/products', async (req: Request, res: Response): Promise<void> => {
  try {
    const cRes = await db.query<{ country_code: string }>(
      `SELECT country_code FROM consumers WHERE consumer_id = $1`, [req.consumer!.consumerId]);
    const country = cRes.rows[0]?.country_code?.toUpperCase();
    if (!country) { res.status(400).json({ error: 'Consumer country not set' }); return; }

    const r = await db.query(
      `SELECT p.product_id AS id, p.name, p.description, p.delivery_type,
              p.is_fixed_price, p.price, p.min_price, p.max_price, p.currency_code,
              m.merchant_id, m.name AS merchant_name, m.wallet_address
         FROM products p
         JOIN merchants m ON m.merchant_id = p.merchant_id
        WHERE p.is_active = TRUE AND m.is_active = TRUE
          AND p.country_code = $1
          AND p.delivery_type NOT IN ('DIRECT', 'VOUCHER')
        ORDER BY m.name, p.name`,
      [country],
    );

    res.json(r.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      deliveryType: row.delivery_type,
      isFixedPrice: row.is_fixed_price,
      price: fromMinorUnits(row.price as string | null),
      minAmount: fromMinorUnits(row.min_price as string | null),
      maxAmount: fromMinorUnits(row.max_price as string | null),
      currency: row.currency_code,
      merchantId: row.merchant_id,
      merchantName: row.merchant_name,
      walletAddress: row.wallet_address,
    })));
  } catch (err) {
    console.error('[GET /api/consumer/products]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/consumer/balance ─────────────────────────────────────────────────

router.get('/balance', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress, consumerId } = req.consumer!;

    const countryRes = await db.query<{ country_code: string }>(
      `SELECT country_code FROM consumers WHERE consumer_id = $1`, [consumerId],
    );
    const spendMeta = await spendCurrencyForCountry(countryRes.rows[0]?.country_code ?? 'ZA');
    const spendCode = spendMeta.currency;
    const spendDec  = spendMeta.decimals;

    const coinsResult = await db.query<{
      internal_code: string;
      contract_address: string | null;
      decimals: number;
      currency_symbol: string | null;
      base_currency: string | null;
      is_treasury: boolean;
    }>(
      `SELECT s.internal_code, s.contract_address, cu.decimals, cu.currency_symbol,
              COALESCE(cu.base_currency_code, cu.currency_code) AS base_currency,
              s.is_treasury_token AS is_treasury
       FROM stablecoins s
       JOIN currencies cu ON cu.currency_code = s.internal_code
       WHERE s.is_active = TRUE AND s.is_deployed = TRUE`,
    );

    const provider = getProvider();

    const balances = await Promise.all(
      coinsResult.rows
        .filter(row => row.contract_address)
        .map(async (coin) => {
          try {
            const contract  = new ethers.Contract(coin.contract_address!, ERC20_BALANCE_ABI, provider);
            const raw       = await contract.balanceOf(walletAddress) as bigint;
            const formatted = ethers.formatUnits(raw, coin.decimals);
            return {
              token:           coin.internal_code,
              symbol:          coin.currency_symbol,
              decimals:        coin.decimals,
              baseCurrency:    coin.base_currency,
              isTreasury:      coin.is_treasury,
              raw:             raw.toString(),
              formatted,
              contractAddress: coin.contract_address,
            };
          } catch {
            return {
              token:        coin.internal_code,
              symbol:       coin.currency_symbol,
              baseCurrency: coin.base_currency,
              isTreasury:   coin.is_treasury,
              raw:          '0',
              formatted:    '0',
              error:        'balance_read_failed',
            };
          }
        }),
    );

    // Home fiat + universal ZAR (TTZA-backed) + USD legs on the vault unified ledger.
    const vaultEntries: Array<Record<string, unknown>> = [];
    let spendRaw = 0n, zarRaw = 0n, usdcRaw = 0n;
    try { spendRaw = await unifiedBalanceOf(walletAddress, spendCode); } catch { /* vault unreachable */ }
    try { zarRaw   = await unifiedBalanceOf(walletAddress, 'ZAR');     } catch { /* ignore */ }
    try { usdcRaw  = await unifiedBalanceOf(walletAddress, 'USDC');     } catch { /* ignore */ }

    if (spendCode !== 'ZAR') {
      vaultEntries.push({
        token: spendCode, symbol: spendMeta.symbol, decimals: spendDec, baseCurrency: spendCode, isTreasury: false,
        raw: spendRaw.toString(), formatted: ethers.formatUnits(spendRaw, spendDec), source: 'vault',
      });
    }
    vaultEntries.push({
      token: 'ZAR', symbol: 'R', decimals: 2, baseCurrency: 'ZAR', isTreasury: false,
      raw: zarRaw.toString(), formatted: ethers.formatUnits(zarRaw, 2), source: 'vault',
    });
    vaultEntries.push({
      token: 'USDC', symbol: '$', decimals: 6, baseCurrency: 'USD', isTreasury: false,
      raw: usdcRaw.toString(), formatted: ethers.formatUnits(usdcRaw, 6), source: 'vault',
    });

    let fxUsdToLocal: number | null = null;
    let fxZarToLocal: number | null = null;
    try { const q = await fxService.getRate('USD', spendCode); fxUsdToLocal = q.rate; } catch { /* ignore */ }
    if (spendCode !== 'ZAR') {
      try { const q = await fxService.getRate('ZAR', spendCode); fxZarToLocal = q.rate; } catch { /* ignore */ }
    }
    const spendF = Number(spendRaw) / 10 ** spendDec;
    const zarF   = Number(zarRaw) / 100;
    const usdF   = Number(usdcRaw) / 1e6;
    const grandLocal = spendCode === 'ZAR'
      ? zarF + (fxUsdToLocal != null ? usdF * fxUsdToLocal : 0)
      : spendF + (fxZarToLocal != null ? zarF * fxZarToLocal : 0) + (fxUsdToLocal != null ? usdF * fxUsdToLocal : 0);

    const summary = {
      localCurrency: spendCode,
      localSymbol: spendMeta.symbol,
      hasSeparateZar: spendCode !== 'ZAR',
      spend: { currency: spendCode, raw: spendRaw.toString(), formatted: spendF.toFixed(spendDec) },
      zar: { currency: 'ZAR', raw: zarRaw.toString(), formatted: zarF.toFixed(2) },
      usd: { raw: usdcRaw.toString(), formatted: usdF.toFixed(2) },
      fxUsdToLocal,
      fxZarToLocal,
      grandTotalLocal: grandLocal.toFixed(spendDec),
    };

    res.json({ walletAddress, balances: [...vaultEntries, ...balances], summary });
  } catch (err) {
    console.error('[GET /api/consumer/balance]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/consumer/transactions ───────────────────────────────────────────

router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit  = Math.min(parseInt((req.query.limit  as string) ?? '20'), 100);
    const offset = parseInt((req.query.offset as string) ?? '0');
    const w = req.consumer!.walletAddress.toLowerCase();

    // The indexer projects on-chain logs into chain_events. Surface this wallet's
    // ledger moves: Credited = top-up/in, Debited = out, Transferred = P2P in/out.
    // Fetch a generous window from the indexer, then merge with off-chain sales and
    // paginate in-memory. Purchases land in merchant_sales immediately on payment;
    // chain_events can lag by several blocks + indexer poll interval.
    const fetchLimit = Math.min(limit + offset + 50, 150);
    const result = await db.query<{ id: string; event_name: string; args: Record<string, string>; ts: string; tx_hash: string }>(
      `SELECT id, event_name, args, COALESCE(block_time, created_at) AS ts, tx_hash
         FROM chain_events
        WHERE event_name IN ('Credited','Debited','Transferred')
          AND ( lower(args->>'user') = $1 OR lower(args->>'from') = $1 OR lower(args->>'to') = $1 )
        ORDER BY block_number DESC, log_index DESC
        LIMIT $2`,
      [w, fetchLimit],
    );

    // currencyCode is stored as the indexed bytes32 hash; map known ones to symbol/decimals.
    const CURRENCIES: Record<string, { sym: string; dec: number }> = {
      [ethers.id('ZAR')]:  { sym: 'ZAR',  dec: 2 },
      [ethers.id('USDC')]: { sym: 'USDC', dec: 6 },
    };

    // Off-chain detail to enrich the bare on-chain events: where a top-up came from
    // (deposit_references) and the rate/fee behind a conversion (consumer_conversions).
    const [refsRes, convRes, salesRes, changeRes] = await Promise.all([
      db.query<{ reference: string; kind: string; source: string; credit_tx: string | null }>(
        `SELECT reference, kind, source, credit_tx FROM deposit_references WHERE LOWER(wallet) = $1`, [w]),
      db.query<{ from_currency: string; to_currency: string; from_amount: string; to_amount: string; rate: string; spread_bps: number; fee_amount: string; fee_currency: string; reference: string | null; debit_tx: string | null; credit_tx: string | null }>(
        `SELECT from_currency, to_currency, from_amount, to_amount, rate, spread_bps, fee_amount, fee_currency, reference, debit_tx, credit_tx FROM consumer_conversions WHERE LOWER(wallet) = $1`, [w]),
      db.query<{ sale_id: number; tx_hash: string | null; amount: string; currency: string; created_at: string; store_number: string | null; till_number: string | null; items: unknown; merchant_name: string | null }>(
        `SELECT s.sale_id, s.tx_hash, s.amount, s.currency, s.created_at,
                s.store_number, s.till_number, s.items, m.name AS merchant_name
           FROM merchant_sales s LEFT JOIN merchants m ON m.merchant_id = s.merchant_id
          WHERE LOWER(s.consumer_wallet) = $1
          ORDER BY s.created_at DESC
          LIMIT 100`, [w]),
      db.query<{ voucher_id: string; amount: string; currency: string; credit_tx: string | null; claimed_at: string | null; created_at: string; merchant_name: string | null; store_number: string | null; till_number: string | null; delivery_mode: string }>(
        `SELECT v.voucher_id, v.amount, v.currency, v.credit_tx, v.claimed_at, v.created_at,
                v.store_number, v.till_number, v.delivery_mode, m.name AS merchant_name
           FROM change_vouchers v
           LEFT JOIN merchants m ON m.merchant_id = v.merchant_id
          WHERE LOWER(v.recipient_wallet) = $1 AND v.status = 'claimed'
          ORDER BY COALESCE(v.claimed_at, v.created_at) DESC
          LIMIT 100`, [w]),
    ]);
    const refByTx = new Map(refsRes.rows.filter(r => r.credit_tx).map(r => [r.credit_tx!.toLowerCase(), r]));
    const convByCreditTx = new Map(convRes.rows.filter(c => c.credit_tx).map(c => [c.credit_tx!.toLowerCase(), c]));
    const convDebitTxs = new Set(convRes.rows.filter(c => c.debit_tx).map(c => c.debit_tx!.toLowerCase()));
    const saleByTx = new Map(salesRes.rows.filter(s => s.tx_hash).map(s => [s.tx_hash!.toLowerCase(), s]));
    const changeByTx = new Map(changeRes.rows.filter(c => c.credit_tx).map(c => [c.credit_tx!.toLowerCase(), c]));

    interface Tx {
      event_id: string; event_type: string; amount_token: string; currency: string;
      created_at: string; tx_hash: string; direction: 'in' | 'out';
      detail?: Record<string, unknown>;
    }
    const transactions: Tx[] = [];
    for (const r of result.rows) {
      const txh = (r.tx_hash ?? '').toLowerCase();
      // The ZAR-debit leg of a conversion is shown as a single "Converted" entry (its credit leg), so skip it.
      if (r.event_name === 'Debited' && convDebitTxs.has(txh)) continue;

      const a   = r.args ?? {};
      const cur = CURRENCIES[(a.currencyCode ?? '').toLowerCase()] ?? { sym: '', dec: 2 };
      const amount_token = ethers.formatUnits(BigInt(a.amount ?? '0'), cur.dec);
      let direction: 'in' | 'out';
      let event_type: string;
      let detail: Record<string, unknown> | undefined;

      const conv = r.event_name === 'Credited' ? convByCreditTx.get(txh) : undefined;
      if (conv) {
        direction = 'in';
        const isZarToUsd = conv.from_currency === 'ZAR';
        event_type = isZarToUsd ? 'Converted to USD' : 'Converted to ZAR';
        if (isZarToUsd) {
          detail = {
            type: 'conversion',
            reference: conv.reference ?? undefined,
            from: `R${ethers.formatUnits(BigInt(conv.from_amount), 2)}`,
            to:   `$${ethers.formatUnits(BigInt(conv.to_amount), 6)}`,
            rate: `${Number(conv.rate).toFixed(4)} $/R`,
            fee:  `R${ethers.formatUnits(BigInt(conv.fee_amount), 2)} (${(conv.spread_bps / 100).toFixed(2)}%)`,
          };
        } else {
          detail = {
            type: 'conversion',
            reference: conv.reference ?? undefined,
            from: `$${ethers.formatUnits(BigInt(conv.from_amount), 6)}`,
            to:   `R${ethers.formatUnits(BigInt(conv.to_amount), 2)}`,
            rate: `${Number(conv.rate).toFixed(2)} R/$`,
            fee:  `$${ethers.formatUnits(BigInt(conv.fee_amount), 6)} (${(conv.spread_bps / 100).toFixed(2)}%)`,
          };
        }
      } else if (r.event_name === 'Credited') {
        const change = changeByTx.get(txh);
        if (change) {
          direction = 'in';
          event_type = 'Change voucher';
          detail = {
            type: 'change_voucher',
            merchant: change.merchant_name ?? 'Store',
            store: change.store_number ?? undefined,
            till: change.till_number ?? undefined,
            delivery: change.delivery_mode,
          };
        } else {
          direction = 'in'; event_type = 'Top up';
          const ref = refByTx.get(txh);
          if (ref) detail = { type: 'topup', source: ref.source === 'consumer' ? 'Voucher' : 'Bank deposit', reference: ref.reference };
        }
      } else if (r.event_name === 'Debited') {
        direction = 'out'; event_type = 'Payment';
      } else {
        direction = (a.from ?? '').toLowerCase() === w ? 'out' : 'in';
        event_type = direction === 'out' ? 'Sent' : 'Received';
      }

      // A transfer out that matches a recorded POS purchase → show it as a Purchase
      // with the merchant, store/till and line items.
      const sale = saleByTx.get(txh);
      if (sale && direction === 'out') {
        event_type = 'Purchase';
        detail = {
          type: 'purchase',
          merchant: sale.merchant_name ?? 'Merchant',
          store: sale.store_number ?? undefined,
          till:  sale.till_number ?? undefined,
          items: Array.isArray(sale.items) ? sale.items : undefined,
        };
      }
      transactions.push({ event_id: String(r.id), event_type, amount_token, currency: cur.sym, created_at: r.ts, tx_hash: r.tx_hash, direction, detail });
    }

    // Purchases recorded in merchant_sales before the indexer catches up (or if the
    // indexer started forward-only and missed a block). Dedupe by tx_hash.
    const seenTx = new Set(transactions.map(t => t.tx_hash.toLowerCase()));
    for (const sale of salesRes.rows) {
      if (!sale.tx_hash) continue;
      const txh = sale.tx_hash.toLowerCase();
      if (seenTx.has(txh)) continue;
      seenTx.add(txh);
      transactions.push({
        event_id:    `sale-${sale.sale_id}`,
        event_type:  'Purchase',
        amount_token: Number(sale.amount).toFixed(2),
        currency:    sale.currency?.toUpperCase() ?? 'ZAR',
        created_at:  sale.created_at,
        tx_hash:     sale.tx_hash,
        direction:   'out',
        detail: {
          type: 'purchase',
          merchant: sale.merchant_name ?? 'Merchant',
          store: sale.store_number ?? undefined,
          till:  sale.till_number ?? undefined,
          items: Array.isArray(sale.items) ? sale.items : undefined,
        },
      });
    }

    for (const cv of changeRes.rows) {
      if (!cv.credit_tx) continue;
      const txh = cv.credit_tx.toLowerCase();
      if (seenTx.has(txh)) continue;
      seenTx.add(txh);
      transactions.push({
        event_id: `change-${cv.voucher_id}`,
        event_type: 'Change voucher',
        amount_token: Number(cv.amount).toFixed(2),
        currency: cv.currency?.toUpperCase() ?? 'ZAR',
        created_at: cv.claimed_at ?? cv.created_at,
        tx_hash: cv.credit_tx,
        direction: 'in',
        detail: {
          type: 'change_voucher',
          merchant: cv.merchant_name ?? 'Store',
          store: cv.store_number ?? undefined,
          till: cv.till_number ?? undefined,
          delivery: cv.delivery_mode,
        },
      });
    }

    transactions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const paged = transactions.slice(offset, offset + limit);

    res.json({ transactions: paged, limit, offset, count: paged.length });
  } catch (err) {
    console.error('[GET /api/consumer/transactions]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/consumer/kyc ─────────────────────────────────────────────────────

router.get('/kyc', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await db.query<KycLevelRow>(
      `SELECT k.* FROM consumers c
       JOIN kyc_levels k ON k.level_id = c.kyc_level_id
       WHERE c.consumer_id = $1`,
      [req.consumer!.consumerId],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: 'KYC level not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /api/consumer/kyc]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Voucher top-up (Sepolia POC) ──────────────────────────────────────────────
// Simulate getting funds in: the user enters any voucher number (validated unique),
// and we mint TTZA backing + credit their Vault ZAR claim, recording the voucher as
// the deposit reference. Defaults to R100, capped at R1000. POC only — on mainnet a
// top-up would be gated on a real, reconciled deposit/voucher.
router.post('/redeem-voucher', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, amount } = req.body as { code?: string; amount?: string };
    const reference = String(code ?? '').replace(/[\s-]/g, '').trim();
    if (reference.length < 4) { res.status(400).json({ error: 'Enter a valid voucher number (at least 4 characters)' }); return; }

    let units = 10_000n; // default R100.00 (2dp)
    if (amount) { try { const u = ethers.parseUnits(String(amount), 2); if (u > 0n && u <= 100_000n) units = u; } catch { /* keep default */ } }

    const r = await cashIn({
      wallet: req.consumer!.walletAddress, amountUnits: units, currency: 'ZAR',
      reference, kind: 'voucher', source: 'consumer',
    });
    res.json({ amount: ethers.formatUnits(units, 2), txHash: r.creditTx });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 500) console.error('[POST /api/consumer/redeem-voucher]', err);
    res.status(status).json({ error: (err as Error).message });
  }
});

// ── POST /api/consumer/convert ────────────────────────────────────────────────
// ZAR ↔ USD and home-fiat ↔ USD on the vault unified ledger. No treasury-to-treasury.
router.post('/convert', async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, from = 'ZAR', to = 'USD' } = req.body as { amount?: string; from?: string; to?: string };
    const wallet = req.consumer!.walletAddress;
    if (!amount) { res.status(400).json({ error: 'amount required' }); return; }

    if (!(await isRegisteredConsumer(wallet))) {
      res.status(403).json({ error: 'Your account is not registered yet', code: 'SENDER_UNREGISTERED' }); return;
    }

    const result = await executeConversion(wallet, String(amount), from, to);
    res.json(result);
  } catch (err) {
    const e = err as Error & { status?: number; code?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
      return;
    }
    console.error('[POST /api/consumer/convert]', err);
    res.status(500).json({ error: e.message });
  }
});

// ── P2P transfer (user-signed, backend-relayed) ───────────────────────────────
// Self-custody send over the Vault unified ledger. The consumer's passkey signs
// the SafeTx for Vault.transfer; the backend relays execTransaction and pays gas
// (Option A). The on-chain KYC gate ("each party a KYC'd consumer or a trusted
// counterparty") is enforced by the Vault, not here — these checks are pre-flight
// UX so the user isn't asked to sign a transaction that would revert.

import {
  buildVaultTransferSafeTx, relaySafeTx, unifiedBalanceOf,
  isRegisteredConsumer, isTrustedCounterparty, sessionTransferDigest, type SafeTx,
} from './safeRelayService.js';
import {
  sessionFeatureReady, getActiveSession, buildSessionStartPrepare, completeSessionStart,
  buildSessionRevokePrepare, completeSessionRevoke, relaySessionPayment, relaySessionSetupTx,
  sessionAmountWithinCaps, defaultSessionCaps,
} from './sessionService.js';
import { getOnChainSession } from './safeRelayService.js';
import { createClaim, escrowAddress } from './escrowService.js';
import { cashIn } from './cashInService.js';
import { fxService } from './fxService.js';
import { quoteMerchantCheckout, resolveMerchantCheckout } from './merchantCheckoutService.js';
import { b64urlToBuf } from './webauthnService.js';

// Decimal places per currency for amount parsing.
const CURRENCY_DECIMALS: Record<string, number> = { ZAR: 2, MWK: 2, USDC: 6 };
function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

// Pending SafeTx store: the server holds the exact tx it built so the client
// cannot tamper between prepare and submit. Keyed by safeTxHash. Short TTL.
const PENDING_TTL_MS = 5 * 60 * 1000;

// Optional merchant-purchase context attached to a transfer from the Buy flow. When
// present, transfer/submit records a merchant_sales row on success.
interface SaleContext {
  merchantId?: string;
  productId?: string;
  storeId?: string;
  storeNumber?: string;
  tillNumber?: string;
  lat?: number;
  lng?: number;
  items?: { name: string; qty: number; unitPrice: number }[];
  chargeAmount?: string;
  chargeCurrency?: string;
  fxRate?: number;
  fxSource?: string;
  fxAsOf?: string | null;
}
interface PendingTransfer {
  safeTx: SafeTx; senderWallet: string; toAddress: string;
  amount: bigint; currency: string; expiry: number;
  recipientPhone?: string;   // set only for escrow (WhatsApp) sends
  sale?: SaleContext;        // set only for merchant purchases (Buy flow)
}
interface PendingSessionTransfer {
  senderWallet: string; toAddress: string; amount: bigint; currency: string;
  sessionAddress: string; deadline: bigint; expiry: number;
  sale?: SaleContext;
}
const pendingTransfers = new Map<string, PendingTransfer>();
const pendingSessionTransfers = new Map<string, PendingSessionTransfer>();
function sweepPending() {
  const now = Date.now();
  for (const [h, p] of pendingTransfers) if (p.expiry < now) pendingTransfers.delete(h);
  for (const [h, p] of pendingSessionTransfers) if (p.expiry < now) pendingSessionTransfers.delete(h);
}

// Record a completed POS purchase in the merchant sales ledger. Best-effort: the
// on-chain payment has already settled, so a bookkeeping failure here must never
// fail the request — it's logged and swallowed.
async function recordMerchantSale(pending: { toAddress: string; senderWallet: string; amount: bigint; currency: string; sale?: SaleContext }, txHash: string): Promise<void> {
  const sale = pending.sale;
  if (!sale) return;
  try {
    const merchantWallet = pending.toAddress;
    // Resolve merchant_id (trust the wallet the payment actually went to over the
    // client-supplied id) and the payer's @tag for readable reporting.
    const [mRes, cRes] = await Promise.all([
      db.query<{ merchant_id: string }>(
        `SELECT merchant_id FROM merchants WHERE LOWER(wallet_address) = LOWER($1)`, [merchantWallet]),
      db.query<{ ens_subdomain: string | null }>(
        `SELECT ens_subdomain FROM consumers WHERE LOWER(wallet_address) = LOWER($1)`, [pending.senderWallet]),
    ]);
    const merchantId  = mRes.rows[0]?.merchant_id ?? sale.merchantId ?? null;
    const consumerTag = cRes.rows[0]?.ens_subdomain ?? null;
    const amountMajor = Number(ethers.formatUnits(pending.amount, decimalsFor(pending.currency)));
    const items = Array.isArray(sale.items)
      ? sale.items.map(i => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice, lineTotal: +(i.qty * i.unitPrice).toFixed(2) }))
      : null;

    const { store, till } = resolveStoreTill(sale.storeNumber, sale.tillNumber);

    await db.query(
      `INSERT INTO merchant_sales
         (merchant_id, merchant_wallet, consumer_wallet, consumer_tag, amount, currency,
          charge_amount, charge_currency, fx_rate, fx_source,
          store_id, store_number, till_number, latitude, longitude, items, tx_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'paid')`,
      [merchantId, merchantWallet, pending.senderWallet, consumerTag, amountMajor,
       pending.currency.toUpperCase(),
       sale.chargeAmount != null ? Number(sale.chargeAmount) : null,
       sale.chargeCurrency?.toUpperCase() ?? null,
       sale.fxRate ?? null,
       sale.fxSource ?? null,
       sale.storeId ?? null, store, till,
       Number.isFinite(sale.lat) ? sale.lat : null, Number.isFinite(sale.lng) ? sale.lng : null,
       items ? JSON.stringify(items) : null, txHash],
    );
  } catch (e) {
    console.error('[recordMerchantSale] failed (non-fatal):', (e as Error).message);
  }
}

/// Resolve a recipient — 0x address, @tag, or on-chain account number.
async function resolveRecipient(toRaw: string): Promise<string> {
  return resolveWalletOrTag(toRaw);
}

// ── GET /api/consumer/checkout/quote ──────────────────────────────────────────
// Store rings up in chargeCurrency (e.g. MWK); consumer pays in settlement currency
// (e.g. ZAR) at the live rate — direct TTZA transfer, no USD hop.
router.get('/checkout/quote', async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantId = String(req.query.merchantId ?? '');
    const storeId = req.query.storeId ? String(req.query.storeId) : undefined;
    const chargeAmount = String(req.query.chargeAmount ?? '');
    const chargeCurrency = String(req.query.chargeCurrency ?? '');
    const payCurrency = req.query.payCurrency ? String(req.query.payCurrency) : undefined;

    if (!merchantId || !chargeAmount || !chargeCurrency) {
      res.status(400).json({ error: 'merchantId, chargeAmount, and chargeCurrency required' });
      return;
    }

    res.json(await quoteMerchantCheckout({ merchantId, storeId, chargeAmount, chargeCurrency, payCurrency }));
  } catch (err) {
    const e = err as Error & { status?: number; code?: string };
    if (e.status) {
      res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
      return;
    }
    console.error('[GET /api/consumer/checkout/quote]', err);
    res.status(500).json({ error: e.message });
  }
});

// ── Session keys (SessionTransferModule) ────────────────────────────────────

router.get('/session/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const enabled = await sessionFeatureReady();
    if (!enabled) { res.json({ enabled: false, active: false }); return; }
    const session = await getActiveSession(req.consumer!.walletAddress);
    res.json({
      enabled: true,
      active: !!session,
      sessionAddress: session?.sessionAddress ?? null,
      expiresAt: session?.expiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error('[GET /api/consumer/session/status]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/session/start/prepare', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionAddress } = req.body as { sessionAddress?: string };
    if (!sessionAddress) { res.status(400).json({ error: 'sessionAddress required' }); return; }
    const wallet = req.consumer!.walletAddress;
    const prepared = await buildSessionStartPrepare(wallet, sessionAddress);
    sweepPending();
    pendingTransfers.set(prepared.safeTxHash, {
      safeTx: prepared.safeTx, senderWallet: wallet, toAddress: sessionAddress, amount: 0n, currency: 'ZAR',
      expiry: Date.now() + PENDING_TTL_MS,
    });
    res.json({
      step: prepared.step,
      safeTxHash: prepared.safeTxHash,
      challenge: Buffer.from(prepared.safeTxHash.slice(2), 'hex').toString('base64url'),
      rpId: config.webauthn.rpId,
      sessionAddress: prepared.sessionAddress,
      ...(prepared.step === 'addSessionKey'
        ? { expiry: prepared.expiry, maxPerTx: prepared.maxPerTx, dailyCap: prepared.dailyCap }
        : {}),
    });
  } catch (err) {
    console.error('[POST /api/consumer/session/start/prepare]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/session/start/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, string>;
    const { safeTxHash, credentialId, authenticatorData, clientDataJSON, signature,
            sessionAddress, expiry, maxPerTx, dailyCap, step } = body;
    if (!safeTxHash || !credentialId || !sessionAddress) {
      res.status(400).json({ error: 'Missing fields' }); return;
    }
    const pending = pendingTransfers.get(safeTxHash);
    if (!pending || pending.expiry < Date.now()) {
      res.status(410).json({ error: 'Session setup expired — try again', code: 'EXPIRED' }); return;
    }
    const cred = await db.query<{ signer_address: string | null }>(
      `SELECT signer_address FROM webauthn_credentials WHERE credential_id = $1`, [credentialId],
    );
    const signer = cred.rows[0]?.signer_address;
    if (!signer) { res.status(404).json({ error: 'Unknown passkey credential' }); return; }

    const assertion = {
      authenticatorData: b64urlToBuf(authenticatorData),
      clientDataJSON: b64urlToBuf(clientDataJSON),
      derSignature: b64urlToBuf(signature),
    };

    if (step === 'enableModule') {
      const txHash = await relaySessionSetupTx({
        walletAddress: req.consumer!.walletAddress,
        ownerSignerAddress: signer,
        safeTx: pending.safeTx,
        assertion,
      });
      pendingTransfers.delete(safeTxHash);
      res.json({ success: true, step: 'enableModule', txHash, sessionAddress });
      return;
    }

    if (!expiry) { res.status(400).json({ error: 'expiry required for addSessionKey step' }); return; }

    const caps = await defaultSessionCaps(req.consumer!.walletAddress);
    const txHash = await completeSessionStart({
      walletAddress: req.consumer!.walletAddress,
      sessionAddress,
      ownerSignerAddress: signer,
      safeTx: pending.safeTx,
      assertion,
      expiry,
      maxPerTx: maxPerTx ?? caps.maxPerTx.toString(),
      dailyCap: dailyCap ?? caps.dailyCap.toString(),
    });
    pendingTransfers.delete(safeTxHash);
    res.json({ success: true, step: 'addSessionKey', txHash, sessionAddress, expiresAt: new Date(Number(expiry) * 1000).toISOString() });
  } catch (err) {
    console.error('[POST /api/consumer/session/start/submit]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/session/revoke/prepare', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionAddress } = req.body as { sessionAddress?: string };
    if (!sessionAddress) { res.status(400).json({ error: 'sessionAddress required' }); return; }
    const wallet = req.consumer!.walletAddress;
    const { safeTx, safeTxHash } = await buildSessionRevokePrepare(wallet, sessionAddress);
    sweepPending();
    pendingTransfers.set(safeTxHash, {
      safeTx, senderWallet: wallet, toAddress: sessionAddress, amount: 0n, currency: 'ZAR',
      expiry: Date.now() + PENDING_TTL_MS,
    });
    res.json({
      safeTxHash,
      challenge: Buffer.from(safeTxHash.slice(2), 'hex').toString('base64url'),
      rpId: config.webauthn.rpId,
      sessionAddress,
    });
  } catch (err) {
    console.error('[POST /api/consumer/session/revoke/prepare]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/session/revoke/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, string>;
    const { safeTxHash, credentialId, authenticatorData, clientDataJSON, signature, sessionAddress } = body;
    const pending = pendingTransfers.get(safeTxHash);
    if (!pending || pending.expiry < Date.now()) {
      res.status(410).json({ error: 'Revoke expired — try again', code: 'EXPIRED' }); return;
    }
    const cred = await db.query<{ signer_address: string | null }>(
      `SELECT signer_address FROM webauthn_credentials WHERE credential_id = $1`, [credentialId],
    );
    const signer = cred.rows[0]?.signer_address;
    if (!signer) { res.status(404).json({ error: 'Unknown passkey credential' }); return; }
    const txHash = await completeSessionRevoke({
      walletAddress: req.consumer!.walletAddress,
      sessionAddress,
      ownerSignerAddress: signer,
      safeTx: pending.safeTx,
      assertion: {
        authenticatorData: b64urlToBuf(authenticatorData),
        clientDataJSON: b64urlToBuf(clientDataJSON),
        derSignature: b64urlToBuf(signature),
      },
    });
    pendingTransfers.delete(safeTxHash);
    res.json({ success: true, txHash });
  } catch (err) {
    console.error('[POST /api/consumer/session/revoke/submit]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/consumer/transfer/prepare ───────────────────────────────────────
// Body: { to: "0x…" | "@tag", amount: "100.00", currency: "ZAR" }
// Returns the SafeTx hash to sign (as a base64url WebAuthn challenge) + a summary.
router.post('/transfer/prepare', async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, amount, currency, sale } = req.body as { to?: string; amount?: string; currency?: string; sale?: SaleContext };
    if (!to || !amount || !currency) { res.status(400).json({ error: 'Missing to, amount, or currency' }); return; }

    const senderWallet = req.consumer!.walletAddress;
    const toAddress = await resolveRecipient(to);
    if (toAddress.toLowerCase() === senderWallet.toLowerCase()) {
      res.status(400).json({ error: 'Cannot send to yourself' }); return;
    }

    let payCurrency = currency.toUpperCase();
    let payAmountStr = String(amount);
    let saleCtx: SaleContext | undefined = sale && typeof sale === 'object' ? { ...sale } : undefined;

    if (saleCtx?.chargeCurrency && saleCtx?.chargeAmount && saleCtx?.merchantId) {
      const resolved = await resolveMerchantCheckout({
        merchantId: saleCtx.merchantId,
        merchantWallet: toAddress,
        storeId: saleCtx.storeId,
        chargeAmount: String(saleCtx.chargeAmount),
        chargeCurrency: saleCtx.chargeCurrency,
        payCurrency,
        clientPayAmount: payAmountStr,
      });
      payAmountStr = resolved.payAmount;
      payCurrency = resolved.payCurrency;
      saleCtx = {
        ...saleCtx,
        chargeAmount: resolved.chargeAmount,
        chargeCurrency: resolved.chargeCurrency,
        fxRate: resolved.fxRate,
        fxSource: resolved.fxSource,
        fxAsOf: resolved.fxAsOf,
      };
    }

    let amountUnits: bigint;
    try { amountUnits = ethers.parseUnits(payAmountStr, decimalsFor(payCurrency)); }
    catch { res.status(400).json({ error: 'Invalid amount' }); return; }
    if (amountUnits <= 0n) { res.status(400).json({ error: 'Amount must be positive' }); return; }

    // Pre-flight compliance mirror of the on-chain gate (better errors before signing).
    // Vault v1.2.0: each party must be a REGISTERED consumer (any level) or trusted.
    const [senderRegistered, recipientRegistered, recipientTrusted, balance] = await Promise.all([
      isRegisteredConsumer(senderWallet), isRegisteredConsumer(toAddress),
      isTrustedCounterparty(toAddress), unifiedBalanceOf(senderWallet, payCurrency),
    ]);
    if (!senderRegistered) { res.status(403).json({ error: 'Your account is not registered yet', code: 'SENDER_UNREGISTERED' }); return; }
    if (!recipientRegistered && !recipientTrusted) {
      res.status(409).json({ error: 'Recipient is not registered yet. Send to escrow until they onboard.', code: 'RECIPIENT_UNVERIFIED' }); return;
    }
    if (balance < amountUnits) {
      res.status(409).json({ error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' }); return;
    }

    sweepPending();

    const activeSession = await sessionFeatureReady()
      ? await getActiveSession(senderWallet)
      : null;

    if (activeSession) {
      const capCheck = sessionAmountWithinCaps(amountUnits, payCurrency, activeSession);
      if (!capCheck.ok) {
        res.status(409).json({
          error: capCheck.reason === 'per_tx'
            ? 'Amount exceeds session per-transaction limit — a new session will be started'
            : 'Amount exceeds session daily limit',
          code: 'SESSION_CAP_EXCEEDED',
        });
        return;
      }

      const onChain = await getOnChainSession(senderWallet, activeSession.sessionAddress);
      if (amountUnits > onChain.maxPerTx) {
        res.status(409).json({
          error: 'Session limits are outdated — please try again to register a new session',
          code: 'SESSION_CAP_EXCEEDED',
        });
        return;
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const digest = await sessionTransferDigest({
        safeAddress: senderWallet,
        sessionKeyAddress: activeSession.sessionAddress,
        toAddress,
        amount: amountUnits,
        currency: payCurrency,
        deadline,
      });
      const transferId = ethers.hexlify(ethers.randomBytes(16));
      pendingSessionTransfers.set(transferId, {
        senderWallet, toAddress, amount: amountUnits, currency: payCurrency,
        sessionAddress: activeSession.sessionAddress, deadline, expiry: Date.now() + PENDING_TTL_MS,
        sale: saleCtx,
      });
      res.json({
        mode: 'session',
        transferId,
        digest,
        deadline: deadline.toString(),
        sessionAddress: activeSession.sessionAddress,
        to: toAddress, amount: payAmountStr, currency: payCurrency,
        charge: saleCtx?.chargeCurrency && saleCtx.chargeCurrency !== payCurrency
          ? { amount: saleCtx.chargeAmount, currency: saleCtx.chargeCurrency, fxRate: saleCtx.fxRate }
          : undefined,
      });
      return;
    }

    const { safeTx, safeTxHash } = await buildVaultTransferSafeTx({
      safeAddress: senderWallet, toAddress, amount: amountUnits, currency: payCurrency,
    });

    pendingTransfers.set(safeTxHash, {
      safeTx, senderWallet, toAddress, amount: amountUnits, currency: payCurrency, expiry: Date.now() + PENDING_TTL_MS,
      sale: saleCtx,
    });

    res.json({
      mode: 'passkey',
      safeTxHash,
      challenge: Buffer.from(safeTxHash.slice(2), 'hex').toString('base64url'),
      rpId: config.webauthn.rpId,
      to: toAddress, amount: payAmountStr, currency: payCurrency,
      charge: saleCtx?.chargeCurrency && saleCtx.chargeCurrency !== payCurrency
        ? { amount: saleCtx.chargeAmount, currency: saleCtx.chargeCurrency, fxRate: saleCtx.fxRate }
        : undefined,
      nonce: safeTx.nonce,
    });
  } catch (err) {
    console.error('[POST /api/consumer/transfer/prepare]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/consumer/transfer/submit ────────────────────────────────────────
// Body: { safeTxHash, credentialId, authenticatorData, clientDataJSON, signature }
//   (the last three base64url, exactly as returned by the passkey get() assertion)
router.post('/transfer/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, string>;
    const { transferId, sessionSignature } = body;

    if (transferId && sessionSignature) {
      const pending = pendingSessionTransfers.get(transferId);
      if (!pending || pending.expiry < Date.now()) {
        res.status(410).json({ error: 'Transfer expired — please start again', code: 'EXPIRED' }); return;
      }
      if (pending.senderWallet.toLowerCase() !== req.consumer!.walletAddress.toLowerCase()) {
        res.status(403).json({ error: 'Transfer does not belong to this account' }); return;
      }

      const txHash = await relaySessionPayment({
        walletAddress: pending.senderWallet,
        sessionAddress: pending.sessionAddress,
        toAddress: pending.toAddress,
        amount: pending.amount,
        currency: pending.currency,
        deadline: pending.deadline,
        signature: sessionSignature,
      });

      pendingSessionTransfers.delete(transferId);
      await recordMerchantSale(pending, txHash);
      res.json({
        success: true, txHash, to: pending.toAddress,
        amount: pending.amount.toString(), currency: pending.currency,
      });
      return;
    }

    const { safeTxHash, credentialId, authenticatorData, clientDataJSON, signature } = body;
    if (!safeTxHash || !credentialId || !authenticatorData || !clientDataJSON || !signature) {
      res.status(400).json({ error: 'Missing signature fields' }); return;
    }

    const pending = pendingTransfers.get(safeTxHash);
    if (!pending || pending.expiry < Date.now()) {
      res.status(410).json({ error: 'Transfer expired — please start again', code: 'EXPIRED' }); return;
    }
    if (pending.senderWallet.toLowerCase() !== req.consumer!.walletAddress.toLowerCase()) {
      res.status(403).json({ error: 'Transfer does not belong to this account' }); return;
    }

    // Defence-in-depth: the signed challenge must equal this SafeTx hash.
    const clientData = JSON.parse(b64urlToBuf(clientDataJSON).toString('utf8')) as { challenge?: string };
    const signedHash = '0x' + b64urlToBuf(clientData.challenge ?? '').toString('hex');
    if (signedHash.toLowerCase() !== safeTxHash.toLowerCase()) {
      res.status(400).json({ error: 'Signed challenge does not match the prepared transfer' }); return;
    }

    // Resolve the Safe owner (the passkey signer) for this credential, and confirm
    // it belongs to the authenticated wallet.
    const cred = await db.query<{ wallet_address: string; signer_address: string | null }>(
      `SELECT wallet_address, signer_address FROM webauthn_credentials WHERE credential_id = $1`,
      [credentialId],
    );
    const row = cred.rows[0];
    if (!row || !row.signer_address) { res.status(404).json({ error: 'Unknown passkey credential' }); return; }
    if (row.wallet_address.toLowerCase() !== pending.senderWallet.toLowerCase()) {
      res.status(403).json({ error: 'Credential does not match the sending wallet' }); return;
    }

    const txHash = await relaySafeTx({
      safeAddress: pending.senderWallet,
      ownerSignerAddress: row.signer_address,
      safeTx: pending.safeTx,
      assertion: {
        authenticatorData: b64urlToBuf(authenticatorData),
        clientDataJSON: b64urlToBuf(clientDataJSON),
        derSignature: b64urlToBuf(signature),
      },
    });

    pendingTransfers.delete(safeTxHash);
    await recordMerchantSale(pending, txHash);   // no-op unless this was a Buy-flow purchase
    res.json({ success: true, txHash, to: pending.toAddress, amount: pending.amount.toString(), currency: pending.currency });
  } catch (err) {
    console.error('[POST /api/consumer/transfer/submit]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Validate a passkey assertion against a pending SafeTx and relay it. Returns the
// relay tx hash; throws Error with a `.status` for the HTTP layer to surface.
async function relaySignedPending(
  pending: PendingTransfer,
  body: { safeTxHash: string; credentialId: string; authenticatorData: string; clientDataJSON: string; signature: string },
): Promise<string> {
  const clientData = JSON.parse(b64urlToBuf(body.clientDataJSON).toString('utf8')) as { challenge?: string };
  const signedHash = '0x' + b64urlToBuf(clientData.challenge ?? '').toString('hex');
  if (signedHash.toLowerCase() !== body.safeTxHash.toLowerCase()) {
    throw Object.assign(new Error('Signed challenge does not match the prepared transfer'), { status: 400 });
  }
  const cred = await db.query<{ wallet_address: string; signer_address: string | null }>(
    `SELECT wallet_address, signer_address FROM webauthn_credentials WHERE credential_id = $1`, [body.credentialId],
  );
  const row = cred.rows[0];
  if (!row || !row.signer_address) throw Object.assign(new Error('Unknown passkey credential'), { status: 404 });
  if (row.wallet_address.toLowerCase() !== pending.senderWallet.toLowerCase()) {
    throw Object.assign(new Error('Credential does not match the sending wallet'), { status: 403 });
  }
  return relaySafeTx({
    safeAddress: pending.senderWallet, ownerSignerAddress: row.signer_address, safeTx: pending.safeTx,
    assertion: {
      authenticatorData: b64urlToBuf(body.authenticatorData),
      clientDataJSON:    b64urlToBuf(body.clientDataJSON),
      derSignature:      b64urlToBuf(body.signature),
    },
  });
}

// ── Escrow send (WhatsApp claim) ──────────────────────────────────────────────
// Send to a not-yet-onboarded recipient: the sender signs a Vault.transfer to the
// custodial escrow address; on submit we mint a claim secret and return a wa.me
// link. The recipient onboards + claims, then the backend releases escrow → them.

// POST /api/consumer/transfer/escrow/prepare  Body: { recipientPhone, amount, currency? }
router.post('/transfer/escrow/prepare', async (req: Request, res: Response): Promise<void> => {
  try {
    const { recipientPhone, amount, currency = 'ZAR' } = req.body as { recipientPhone?: string; amount?: string; currency?: string };
    if (!recipientPhone || !amount) { res.status(400).json({ error: 'Missing recipientPhone or amount' }); return; }
    const phone = String(recipientPhone).replace(/[^\d+]/g, '');
    if (phone.replace(/\D/g, '').length < 7) { res.status(400).json({ error: 'Enter a valid phone number with country code' }); return; }

    const senderWallet = req.consumer!.walletAddress;
    let amountUnits: bigint;
    try { amountUnits = ethers.parseUnits(String(amount), decimalsFor(currency)); }
    catch { res.status(400).json({ error: 'Invalid amount' }); return; }
    if (amountUnits <= 0n) { res.status(400).json({ error: 'Amount must be positive' }); return; }

    const escrow = escrowAddress();
    const [senderRegistered, balance] = await Promise.all([
      isRegisteredConsumer(senderWallet), unifiedBalanceOf(senderWallet, currency),
    ]);
    if (!senderRegistered) { res.status(403).json({ error: 'Your account is not registered yet', code: 'SENDER_UNREGISTERED' }); return; }
    if (balance < amountUnits) { res.status(409).json({ error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' }); return; }

    const { safeTx, safeTxHash } = await buildVaultTransferSafeTx({
      safeAddress: senderWallet, toAddress: escrow, amount: amountUnits, currency,
    });

    sweepPending();
    pendingTransfers.set(safeTxHash, {
      safeTx, senderWallet, toAddress: escrow, amount: amountUnits, currency,
      recipientPhone: phone, expiry: Date.now() + PENDING_TTL_MS,
    });

    res.json({
      safeTxHash,
      challenge: Buffer.from(safeTxHash.slice(2), 'hex').toString('base64url'),
      rpId: config.webauthn.rpId,
      recipientPhone: phone, amount: String(amount), currency: currency.toUpperCase(),
    });
  } catch (err) {
    console.error('[POST /api/consumer/transfer/escrow/prepare]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/consumer/transfer/escrow/submit  Body: { safeTxHash, credentialId, authenticatorData, clientDataJSON, signature }
router.post('/transfer/escrow/submit', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, string>;
    if (!body.safeTxHash || !body.credentialId || !body.authenticatorData || !body.clientDataJSON || !body.signature) {
      res.status(400).json({ error: 'Missing signature fields' }); return;
    }
    const pending = pendingTransfers.get(body.safeTxHash);
    if (!pending || pending.expiry < Date.now()) { res.status(410).json({ error: 'Transfer expired — please start again', code: 'EXPIRED' }); return; }
    if (!pending.recipientPhone) { res.status(400).json({ error: 'Not an escrow transfer' }); return; }
    if (pending.senderWallet.toLowerCase() !== req.consumer!.walletAddress.toLowerCase()) {
      res.status(403).json({ error: 'Transfer does not belong to this account' }); return;
    }

    const txHash = await relaySignedPending(pending, body as never);

    const { secret, expiresAt } = await createClaim({
      senderWallet: pending.senderWallet, recipientPhone: pending.recipientPhone,
      amount: pending.amount, currency: pending.currency, escrowTx: txHash,
    });
    pendingTransfers.delete(body.safeTxHash);

    // Build the wa.me deep-link the sender taps to message the recipient.
    const claimUrl = `${config.webauthn.origin}/#/claim/${secret}`;
    const display  = (Number(pending.amount) / 10 ** decimalsFor(pending.currency)).toFixed(2);
    const appName  = await getAppDisplayName();
    const text     = `I sent you R${display} on ${appName || config.webauthn.rpName}. Tap to claim it: ${claimUrl}`;
    const waLink   = `https://wa.me/${pending.recipientPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

    res.json({ success: true, txHash, claimUrl, waLink, expiresAt, amount: pending.amount.toString(), currency: pending.currency });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 500) console.error('[POST /api/consumer/transfer/escrow/submit]', err);
    res.status(status).json({ error: (err as Error).message });
  }
});

// ── Investments (non-custodial) ───────────────────────────────────────────────
// The broker ledger (platform-held positions, buy/sell endpoints) was removed:
// under the non-custodial DEX model the asset lives in the consumer's own Safe
// wallet. Holdings are therefore the on-chain token balance (read via /balance),
// and a "buy" is a Pimlico-sponsored Uniswap swap UserOp from the Safe — added
// in step 2 (execution). Live pricing is served by the public /api/assets route.

export default router;
