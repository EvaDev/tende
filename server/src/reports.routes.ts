// src/reports.routes.ts
// Admin reporting over the indexed chain_events (mounted at /api/admin/reports).
// The indexer is the data source (chain = truth); these endpoints are read-only
// projections for ops / compliance / revenue reporting.

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import db from './db.js';
import config from './config.js';
import { allowPublicPage } from './admin.middleware.js';
import { buildAddressLabelMap, labelForAddress } from './addressLabels.js';
import { unifiedBalanceOf } from './safeRelayService.js';

const router = express.Router();

// Vault currency codes are emitted as indexed bytes32 (keccak256 of the symbol),
// so chain_events stores the hash. Map known hashes back to readable symbols.
const CURRENCY_BY_HASH: Record<string, string> = {};
for (const code of ['ZAR', 'USDC', 'USD', 'ZWL', 'MWK', 'ZARP', 'ZARU']) {
  CURRENCY_BY_HASH[ethers.id(code).toLowerCase()] = code;
}
const decodeCurrency = (hash: unknown): string => {
  const h = String(hash ?? '').toLowerCase();
  return CURRENCY_BY_HASH[h] ?? h;
};

// Minor-unit decimals per currency (USD-family = 6 like USDC; everything else 2dp).
const DECIMALS: Record<string, number> = { USDC: 6, USD: 6 };
const decimalsFor = (currency: string): number => DECIMALS[currency] ?? 2;

// Format a raw minor-unit amount (string/number) to a major-unit display string.
const toMajor = (raw: unknown, decimals: number): string =>
  (Number(raw ?? 0) / 10 ** decimals).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });

async function buildPartyLabels(): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const set = (addr: string | undefined | null, label: string) => {
    if (addr && /^0x[0-9a-fA-F]{40}$/.test(addr)) labels.set(addr.toLowerCase(), label);
  };
  set(config.contracts.vault, 'Vault');
  set(config.platform.treasuryAddress, 'Platform');
  set(config.platform.escrowAddress, 'Escrow');
  try {
    const cons = await db.query<{ w: string; ens: string | null }>(
      `SELECT LOWER(wallet_address) w, ens_subdomain ens FROM consumers WHERE wallet_address IS NOT NULL`);
    for (const r of cons.rows) {
      set(r.w, r.ens ? `@${r.ens}` : 'Consumer');
    }
    const merch = await db.query<{ w: string; name: string }>(
      `SELECT LOWER(wallet_address) w, name FROM merchants WHERE wallet_address IS NOT NULL`);
    for (const r of merch.rows) {
      set(r.w, r.name);
    }
  } catch { /* tables may be absent */ }
  return labels;
}

function partyLabel(addr: string, labels: Map<string, string>): string {
  return labels.get((addr ?? '').toLowerCase()) ?? addr;
}

async function sumSegmentZar(wallets: string[]): Promise<number> {
  let total = 0;
  for (const w of wallets) {
    try {
      const raw = await unifiedBalanceOf(w, 'ZAR');
      total += Number(raw) / 100;
    } catch { /* skip */ }
  }
  return total;
}

async function sumSegmentUsdc(wallets: string[]): Promise<number> {
  let total = 0;
  for (const w of wallets) {
    try {
      const raw = await unifiedBalanceOf(w, 'USDC');
      total += Number(raw) / 1e6;
    } catch { /* skip */ }
  }
  return total;
}

const amountDisplay = (raw: unknown, currency: string): string => {
  const dec = decimalsFor(currency);
  const major = toMajor(raw, dec);
  if (currency === 'ZAR') return `R${major}`;
  if (currency === 'USD' || currency === 'USDC') return `$${major}`;
  return major;
};

/** Contract address → treasury token code + on-chain decimals (TreasuryToken.sol = 2dp). */
async function buildTreasuryTokenRegistry(): Promise<Map<string, { code: string; decimals: number }>> {
  const map = new Map<string, { code: string; decimals: number }>();
  const TREASURY_DECIMALS = 2;
  try {
    const q = await db.query<{ address: string; code: string }>(
      `SELECT lower(s.contract_address) AS address, s.internal_code AS code
         FROM stablecoins s
        WHERE s.is_treasury_token = TRUE AND s.contract_address IS NOT NULL`,
    );
    for (const r of q.rows) map.set(r.address, { code: r.code, decimals: TREASURY_DECIMALS });
  } catch { /* stablecoins absent */ }
  if (map.size === 0 && config.contracts.treasuryTokenZA) {
    map.set(config.contracts.treasuryTokenZA.toLowerCase(), { code: 'TTZA', decimals: TREASURY_DECIMALS });
  }
  if (config.contracts.treasuryTokenZW) {
    const zw = config.contracts.treasuryTokenZW.toLowerCase();
    if (!map.has(zw)) map.set(zw, { code: 'TTZW', decimals: TREASURY_DECIMALS });
  }
  return map;
}

function tokenForAddress(
  registry: Map<string, { code: string; decimals: number }>,
  address: string | null | undefined,
): { code: string; decimals: number } {
  const hit = registry.get(String(address ?? '').toLowerCase());
  return hit ?? { code: 'TTZA', decimals: 2 };
}

// GET /api/admin/reports/summary — counts by contract/event + indexer cursor.
router.get('/summary', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const total  = await db.query(`SELECT count(*)::int n, MIN(block_number) minb, MAX(block_number) maxb FROM chain_events`);
    const byType = await db.query(`SELECT contract, event_name, count(*)::int n FROM chain_events GROUP BY contract, event_name ORDER BY contract, event_name`);
    const cursor = await db.query(`SELECT last_block, updated_at FROM indexer_cursor WHERE id = 1`);
    res.json({
      totalEvents: total.rows[0].n,
      blockRange:  [total.rows[0].minb, total.rows[0].maxb],
      cursor:      cursor.rows[0] ?? null,
      byType:      byType.rows,
    });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/events?contract=&event=&address=&fromBlock=&toBlock=&limit=&offset=
router.get('/events', allowPublicPage('reports'), async (req: Request, res: Response): Promise<void> => {
  const where: string[] = []; const vals: (string | number)[] = [];
  if (req.query.contract) { vals.push(String(req.query.contract));            where.push(`contract = $${vals.length}`); }
  if (req.query.event)    { vals.push(String(req.query.event));               where.push(`event_name = $${vals.length}`); }
  if (req.query.address)  { vals.push(String(req.query.address).toLowerCase()); where.push(`(address = $${vals.length} OR args->>'from' = $${vals.length} OR args->>'to' = $${vals.length})`); }
  if (req.query.fromBlock){ vals.push(Number(req.query.fromBlock));            where.push(`block_number >= $${vals.length}`); }
  if (req.query.toBlock)  { vals.push(Number(req.query.toBlock));              where.push(`block_number <= $${vals.length}`); }
  const limit  = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  vals.push(limit);  const lp = vals.length;
  vals.push(offset); const op = vals.length;
  try {
    const r = await db.query(
      `SELECT block_number, block_time, contract, event_name, tx_hash, log_index, args
       FROM chain_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY block_number DESC, log_index DESC LIMIT $${lp} OFFSET $${op}`,
      vals);
    res.json({ count: r.rows.length, limit, offset, events: r.rows });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/settlement-fees — platform revenue from merchant settlements.
router.get('/settlement-fees', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query<{ currency: string; settlements: number; total_fee: string; total_gross: string }>(
      `SELECT currency,
              COUNT(*)::int AS settlements,
              COALESCE(SUM(fee_amount), 0)::text AS total_fee,
              COALESCE(SUM(amount), 0)::text AS total_gross
         FROM settlement_requests
        WHERE status = 'executed' AND COALESCE(fee_amount, 0) > 0
        GROUP BY currency`,
    );
    res.json(r.rows.map(x => ({
      currency: x.currency,
      settlements: x.settlements,
      totalFee: Number(x.total_fee).toFixed(2),
      totalGross: Number(x.total_gross).toFixed(2),
    })));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/withdrawal-fees — platform revenue from external USDC withdrawals.
router.get('/withdrawal-fees', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query<{ currency: string; withdrawals: number; total_fee: string; total_net: string; total_gross: string }>(
      `SELECT currency,
              COUNT(*)::int AS withdrawals,
              COALESCE(SUM(fee_units), 0)::text AS total_fee,
              COALESCE(SUM(net_units), 0)::text AS total_net,
              COALESCE(SUM(gross_units), 0)::text AS total_gross
         FROM consumer_withdrawals
        WHERE status = 'executed'
        GROUP BY currency`,
    );
    res.json(r.rows.map(x => {
      const dec = x.currency.toUpperCase() === 'USDC' || x.currency.toUpperCase() === 'USD' ? 6 : 2;
      return {
        currency: x.currency,
        withdrawals: x.withdrawals,
        totalFee: (Number(x.total_fee) / 10 ** dec).toFixed(2),
        totalNet: (Number(x.total_net) / 10 ** dec).toFixed(2),
        totalGross: (Number(x.total_gross) / 10 ** dec).toFixed(2),
      };
    }));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/settlements — merchant fiat/on-chain payout requests.
router.get('/settlements', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query<{
      id: number; merchant_id: string; merchant_name: string; amount: string; currency: string;
      destination: string; status: string; requested_by_name: string | null;
      approved_at: string | null; executed_tx_hash: string | null; created_at: string;
      settlement_type: string; fee_amount: string | null; net_amount: string | null;
    }>(
      `SELECT sr.id, sr.merchant_id, m.name AS merchant_name, sr.amount, sr.currency,
              sr.destination, sr.status, mm.display_name AS requested_by_name,
              sr.approved_at, sr.executed_tx_hash, sr.created_at, m.settlement_type,
              sr.fee_amount::text, sr.net_amount::text
         FROM settlement_requests sr
         JOIN merchants m ON m.merchant_id = sr.merchant_id
         LEFT JOIN merchant_members mm ON mm.id = sr.requested_by
        ORDER BY sr.created_at DESC LIMIT 500`,
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/transfers — value movements (the flow / Travel-Rule feed).
router.get('/transfers', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const labels = await buildPartyLabels();
    const r = await db.query(
      `SELECT block_number, block_time, tx_hash,
              args->>'from' AS "from", args->>'to' AS "to",
              args->>'amount' AS amount, args->>'currencyCode' AS currency_hash
       FROM chain_events WHERE event_name = 'Transferred'
       ORDER BY block_number DESC LIMIT 500`);
    res.json(r.rows.map(x => {
      const currency = decodeCurrency(x.currency_hash);
      const dec = decimalsFor(currency);
      const amountRaw = Number(x.amount ?? 0);
      return {
        ...x,
        currency,
        amountDisplay: amountDisplay(x.amount, currency),
        amountValue: amountRaw / 10 ** dec,
        fromLabel: partyLabel(x.from, labels),
        toLabel: partyLabel(x.to, labels),
      };
    }));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/withdrawals — external USDC withdrawals + Travel Rule beneficiary.
router.get('/withdrawals', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const labels = await buildPartyLabels();
    const r = await db.query<{
      id: string; from_wallet: string; to_address: string; gross_units: string; fee_units: string;
      net_units: string; fee_bps: number; status: string; withdraw_tx: string | null;
      recipient_name: string | null; recipient_id_number: string | null; recipient_phone: string | null;
      recipient_country: string | null; recipient_relationship: string | null;
      created_at: Date; executed_at: Date | null; sender_tag: string | null; sender_display: string | null;
    }>(
      `SELECT w.id, w.from_wallet, w.to_address, w.gross_units::text, w.fee_units::text, w.net_units::text,
              w.fee_bps, w.status, w.withdraw_tx, w.recipient_name, w.recipient_id_number, w.recipient_phone,
              w.recipient_country, w.recipient_relationship, w.created_at, w.executed_at,
              c.ens_subdomain AS sender_tag, c.display_name AS sender_display
         FROM consumer_withdrawals w
         LEFT JOIN consumers c ON c.consumer_id = w.consumer_id
        ORDER BY w.created_at DESC
        LIMIT 500`,
    );
    res.json(r.rows.map(row => {
      const gross = Number(row.gross_units);
      const fee = Number(row.fee_units);
      const net = Number(row.net_units);
      return {
        ...row,
        currency: 'USDC',
        grossDisplay: (gross / 1e6).toFixed(2),
        feeDisplay: (fee / 1e6).toFixed(2),
        netDisplay: (net / 1e6).toFixed(2),
        fromLabel: row.sender_display || row.sender_tag || partyLabel(row.from_wallet, labels),
        toLabel: row.recipient_name
          ? `${row.recipient_name} (${row.to_address.slice(0, 6)}…${row.to_address.slice(-4)})`
          : partyLabel(row.to_address, labels),
      };
    }));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/gas-fees — total ETH gas paid by the platform relayer.
router.get('/gas-fees', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const { getGasFeeTotals } = await import('./gasCostService.js');
    res.json(await getGasFeeTotals());
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/revenue — protocol revenue = sum of harvested platform cut.
router.get('/revenue', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT args->>'currencyCode' AS currency_hash,
              SUM((args->>'platformCut')::numeric)::text AS platform_cut,
              count(*)::int AS harvests
       FROM chain_events WHERE event_name = 'YieldHarvested'
       GROUP BY args->>'currencyCode'`);
    res.json(r.rows.map(x => {
      const currency = decodeCurrency(x.currency_hash);
      const dec = decimalsFor(currency);
      const raw = Number(x.platform_cut ?? 0);
      return {
        currency,
        platformCut: x.platform_cut,
        platformCutDisplay: toMajor(raw, dec),
        harvests: x.harvests,
      };
    }));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/conversion-fees — platform revenue from FX conversions (the
// spread). The fee is retained in the reserve (the consumer is credited the
// post-spread amount); it's recorded per-conversion in consumer_conversions.
router.get('/conversion-fees', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query<{ fee_currency: string; total_fee: string; total_from_major: string; conversions: number }>(
      `SELECT fee_currency,
              SUM(fee_amount)::numeric AS total_fee,
              SUM(CASE WHEN from_currency IN ('USD','USDC')
                       THEN from_amount::numeric / 1e6
                       ELSE from_amount::numeric / 100 END)::text AS total_from_major,
              count(*)::int AS conversions
         FROM consumer_conversions GROUP BY fee_currency`);
    const FEE_DECIMALS: Record<string, number> = { USD: 6, USDC: 6 };
    res.json(r.rows.map(x => {
      const dec = FEE_DECIMALS[x.fee_currency.toUpperCase()] ?? 2;
      return {
        feeCurrency:    x.fee_currency,
        conversions:    x.conversions,
        totalFee:       (Number(x.total_fee) / 10 ** dec).toFixed(2),
        totalConverted: Number(x.total_from_major).toFixed(2),
      };
    }));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/registrations — the sign-up funnel. Attempts are recorded
// before any on-chain work (registration_attempts), so failed / abandoned sign-ups
// are counted here — unlike the consumers table, which only holds completed ones.
// This is what reconciles on-chain ConsumerRegistered events vs consumers rows: the
// difference is attempts that reached 'deploy' but failed before writing the DB row.
router.get('/registrations', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    // Self-heal: registration can finish writing `consumers` then fail to mark the
    // attempt completed (best-effort tracker). Those stuck `started` rows inflate
    // "never finished" and understate success rate vs the Consumers dashboard count.
    await db.query(
      `UPDATE registration_attempts ra
          SET status = 'completed',
              current_step = 'done',
              error = CASE
                WHEN error IS NULL OR error = '' THEN 'Reconciled: consumer row exists'
                ELSE error
              END,
              updated_at = NOW()
        WHERE ra.status = 'started'
          AND ra.wallet_address IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM consumers c
             WHERE LOWER(c.wallet_address) = LOWER(ra.wallet_address)
          )`,
    );

    const totals = await db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int n FROM registration_attempts GROUP BY status`);
    const byFailedStep = await db.query<{ failed_step: string | null; n: number }>(
      `SELECT COALESCE(failed_step, current_step) AS failed_step, count(*)::int n
         FROM registration_attempts
        WHERE status IN ('failed', 'started')
        GROUP BY COALESCE(failed_step, current_step)
        ORDER BY n DESC`);
    const recentIncomplete = await db.query(
      `SELECT attempt_id, status, current_step, failed_step, error, ens_subdomain, country_code,
              wallet_address, created_at
         FROM registration_attempts
        WHERE status IN ('failed', 'started')
        ORDER BY created_at DESC LIMIT 50`);

    const byStatus: Record<string, number> = {};
    for (const r of totals.rows) byStatus[r.status] = r.n;
    const completed = byStatus.completed ?? 0;
    const failed = byStatus.failed ?? 0;
    const started = byStatus.started ?? 0;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const notCompleted = failed + started;

    res.json({
      total,
      completed,
      failed,
      started,                 // never finished — crashed or still in-flight
      notCompleted,            // failed + started (matches 100% − success rate)
      byFailedStep: byFailedStep.rows,
      recentFailures: recentIncomplete.rows, // includes incomplete (status shown in UI)
    });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/sales — one line per merchant: aggregate POS sales from
// the merchant_sales ledger. LEFT JOIN so merchants with no sales still show (0s).
router.get('/sales', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT m.merchant_id, m.name,
              COUNT(s.sale_id)::int                       AS sales,
              COALESCE(SUM(s.amount), 0)::text            AS total,
              COUNT(DISTINCT s.consumer_wallet)::int      AS customers,
              COUNT(DISTINCT NULLIF(COALESCE(s.store_number,'') || '/' || COALESCE(s.till_number,''), '/'))::int AS tills,
              MAX(s.created_at)                           AS last_sale,
              MIN(s.currency)                             AS currency
         FROM merchants m
         LEFT JOIN merchant_sales s ON s.merchant_id = m.merchant_id
        GROUP BY m.merchant_id, m.name
        ORDER BY COALESCE(SUM(s.amount), 0) DESC, m.name ASC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/balances — the Vault's per-currency user balance ledger.
// Credited / Debited are emitted only by the admin/settlement balance ops (Vault
// adminCredit/credit/adminDebit) — top-ups, voucher redemptions, spends, the two
// legs of an FX conversion, and manual corrections. They move a user's spendable
// balance without moving tokens. P2P `Transferred` shifts balances between users
// (net-zero system-wide, so excluded here — see the Transfers report); Minted/Burned
// are the TreasuryToken lifecycle (see Mint & Burn). Net = credited − debited is the
// vault's outstanding backing (AUM) per currency.
router.get('/balances', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    // Currency metadata → resolve each Vault currency code to its fiat + the on-chain
    // token that represents it (ZAR → treasury token TTZA; USDC → fiat USD). Driven by
    // the currencies table so new currencies map automatically.
    const cur = await db.query<{ currency_code: string; currency_type: string; base_currency_code: string | null }>(
      `SELECT currency_code, currency_type, base_currency_code FROM currencies`);
    const meta      = new Map<string, { type: string; base: string | null }>();
    const tokenFor  = new Map<string, string>();   // fiat code → token code (treasury preferred)
    for (const r of cur.rows) {
      meta.set(r.currency_code, { type: r.currency_type, base: r.base_currency_code });
      if ((r.currency_type === 'TREASURY' || r.currency_type === 'STABLECOIN') && r.base_currency_code) {
        if (!tokenFor.has(r.base_currency_code) || r.currency_type === 'TREASURY') {
          tokenFor.set(r.base_currency_code, r.currency_code);
        }
      }
    }
    // A Vault code is either a fiat (backed by a token) or already a token (whose fiat
    // is its base). Returns the display fiat + token symbol for either case.
    const fiatAndToken = (symbol: string): { fiat: string; token: string | null } => {
      const m = meta.get(symbol);
      if (!m) return { fiat: symbol, token: null };
      if (m.type === 'FIAT') return { fiat: symbol, token: tokenFor.get(symbol) ?? null };
      return { fiat: m.base ?? symbol, token: symbol };
    };

    // Wallet → payment tag (@ens) and tx → transaction-type classification.
    const cons = await db.query<{ w: string; ens: string | null }>(
      `SELECT LOWER(wallet_address) w, ens_subdomain ens FROM consumers WHERE wallet_address IS NOT NULL`);
    const tagByWallet = new Map<string, string>();
    for (const r of cons.rows) if (r.ens) tagByWallet.set(r.w, r.ens);

    const conv = await db.query<{ dt: string | null; ct: string | null }>(
      `SELECT LOWER(debit_tx) dt, LOWER(credit_tx) ct FROM consumer_conversions`);
    const convBuyTx = new Set<string>();   // credit leg (received the bought currency)
    const convSellTx = new Set<string>();  // debit leg (spent the source currency)
    for (const r of conv.rows) { if (r.ct) convBuyTx.add(r.ct); if (r.dt) convSellTx.add(r.dt); }

    const byCur = await db.query<{ currency_hash: string; credited: string; debited: string; users: number; last_activity: string }>(
      `SELECT args->>'currencyCode' AS currency_hash,
              SUM(CASE WHEN event_name='Credited' THEN (args->>'amount')::numeric ELSE 0 END)::text AS credited,
              SUM(CASE WHEN event_name='Debited'  THEN (args->>'amount')::numeric ELSE 0 END)::text AS debited,
              COUNT(DISTINCT args->>'user')::int AS users,
              MAX(block_time) AS last_activity
         FROM chain_events
        WHERE event_name IN ('Credited','Debited')
        GROUP BY args->>'currencyCode'`);

    const byCurrency = byCur.rows.map((r) => {
      const currency = decodeCurrency(r.currency_hash);
      const dec      = decimalsFor(currency);
      const netRaw   = Number(r.credited) - Number(r.debited);
      const { fiat, token } = fiatAndToken(currency);
      return {
        currency: fiat,
        token,
        credited:     toMajor(r.credited, dec),
        debited:      toMajor(r.debited, dec),
        net:          toMajor(netRaw, dec),
        netValue:     netRaw / 10 ** dec,
        users:        r.users,
        lastActivity: r.last_activity,
        consumerNet:  null as string | null,
        merchantNet:  null as string | null,
      };
    }).sort((a, b) => b.netValue - a.netValue);

    const zarRow = byCurrency.find(r => r.currency === 'ZAR');
    const usdRow = byCurrency.find(r => r.currency === 'USD' || r.token === 'USDC');
    if (zarRow || usdRow) {
      const [consW, merchW] = await Promise.all([
        db.query<{ wallet_address: string }>(`SELECT wallet_address FROM consumers WHERE wallet_address IS NOT NULL`),
        db.query<{ wallet_address: string }>(`SELECT wallet_address FROM merchants WHERE wallet_address IS NOT NULL`),
      ]);
      const consAddrs = consW.rows.map(r => r.wallet_address);
      const merchAddrs = merchW.rows.map(r => r.wallet_address);
      if (zarRow) {
        const consumerZar = await sumSegmentZar(consAddrs);
        const merchantZar = await sumSegmentZar(merchAddrs);
        zarRow.consumerNet = toMajor(Math.round(consumerZar * 100), 2);
        zarRow.merchantNet = toMajor(Math.round(merchantZar * 100), 2);
      }
      if (usdRow) {
        // Ledger Credited/Debited misses harvest (price-per-share lift). Net + segments = on-chain.
        const consumerUsdc = await sumSegmentUsdc(consAddrs);
        const merchantUsdc = await sumSegmentUsdc(merchAddrs);
        const netOnChain = consumerUsdc + merchantUsdc;
        usdRow.consumerNet = toMajor(Math.round(consumerUsdc * 1e6), 6);
        usdRow.merchantNet = toMajor(Math.round(merchantUsdc * 1e6), 6);
        usdRow.net = toMajor(Math.round(netOnChain * 1e6), 6);
        usdRow.netValue = netOnChain;
      }
    }

    const led = await db.query<{ block_time: string; block_number: string; log_index: number; event_name: string; user: string; amount: string; currency_hash: string; creditor: string | null; tx_hash: string }>(
      `SELECT block_time, block_number, log_index, event_name,
              args->>'user'         AS "user",
              args->>'amount'       AS amount,
              args->>'currencyCode' AS currency_hash,
              args->>'creditor'     AS creditor,
              tx_hash
         FROM chain_events
        WHERE event_name IN ('Credited','Debited')
        ORDER BY block_number DESC, log_index DESC LIMIT 200`);

    const ledger = led.rows.map((r) => {
      const symbol    = decodeCurrency(r.currency_hash);
      const dec       = decimalsFor(symbol);
      const direction = r.event_name === 'Credited' ? 'Credit' : 'Debit';
      const tx        = r.tx_hash.toLowerCase();
      const { fiat, token } = fiatAndToken(symbol);
      const type = convBuyTx.has(tx)  ? 'Conversion (buy)'
                 : convSellTx.has(tx) ? 'Conversion (sell)'
                 : direction === 'Credit' ? 'Top-up' : 'Payment';
      return {
        blockNumber: Number(r.block_number),
        logIndex:    r.log_index,
        blockTime:   r.block_time,
        direction,
        type,
        user:        r.user,
        userTag:     tagByWallet.get((r.user ?? '').toLowerCase()) ?? null,
        amount:      toMajor(r.amount, dec),
        amountValue: Number(r.amount) / 10 ** dec,   // numeric, for client-side sorting
        currency:    fiat,
        token,
        creditor:    r.creditor,   // credits only; Debited carries no actor (see report note)
        txHash:      r.tx_hash,
      };
    });

    res.json({ byCurrency, ledger });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/treasury — minting/burning of treasury tokens + asset
// purchases, each linked to its off-chain deposit reference (voucher / bank ref).
router.get('/treasury', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const tokenRegistry = await buildTreasuryTokenRegistry();

    const evs = await db.query<{ block_time: string; tx_hash: string; event_name: string; args: Record<string, string>; address: string }>(
      `SELECT block_time, tx_hash, event_name, args, address
         FROM chain_events
        WHERE event_name IN ('Minted','Burned','UsdPurchased')
        ORDER BY block_number DESC, log_index DESC LIMIT 500`);

    const [refs, convRefs, changeMintRefs, labels] = await Promise.all([
      db.query<{ mint_tx: string; reference: string; kind: string; source: string }>(
        `SELECT lower(mint_tx) AS mint_tx, reference, kind, source FROM deposit_references WHERE mint_tx IS NOT NULL`),
      db.query<{ mint_tx: string | null; credit_tx: string | null; reference: string; from_currency: string; to_currency: string }>(
        `SELECT lower(mint_tx) AS mint_tx, lower(credit_tx) AS credit_tx, reference, from_currency, to_currency
           FROM consumer_conversions WHERE reference IS NOT NULL`),
      db.query<{ mint_tx: string; store_number: string | null; voucher_id: string }>(
        `SELECT lower(mint_tx) AS mint_tx, store_number, voucher_id::text AS voucher_id
           FROM change_vouchers WHERE mint_tx IS NOT NULL`).catch(() => ({ rows: [] as { mint_tx: string; store_number: string | null; voucher_id: string }[] })),
      buildAddressLabelMap(),
    ]);

    const refByTx: Record<string, { reference: string; kind: string; source: string }> = {};
    for (const r of refs.rows) refByTx[r.mint_tx] = { reference: r.reference, kind: r.kind, source: r.source };
    for (const c of changeMintRefs.rows) {
      if (refByTx[c.mint_tx]) continue;
      const store = (c.store_number || 'STORE').trim();
      refByTx[c.mint_tx] = {
        reference: `${store}/CV-${c.voucher_id}`,
        kind: 'change_voucher',
        source: 'merchant',
      };
    }

    const convByMintTx = new Map<string, typeof convRefs.rows[0]>();
    for (const c of convRefs.rows) {
      if (c.mint_tx) convByMintTx.set(c.mint_tx, c);
    }

    const events = evs.rows.map((e) => {
      const a = e.args ?? {};
      const txKey = String(e.tx_hash).toLowerCase();
      if (e.event_name === 'UsdPurchased') {
        return { type: 'Asset purchase', token: 'USDC', decimals: 6, amount: a.usdcReceived ?? '0',
                 spent: a.localAmount ?? '0', spentCurrency: decodeCurrency(a.localCurrency), spentDecimals: 2,
                 party: a.buyer ?? '', partyName: labelForAddress(labels, a.buyer ?? ''),
                 reference: null, refKind: null, refSource: null,
                 txHash: e.tx_hash, blockTime: e.block_time };
      }
      const depRef = refByTx[txKey];
      const convRef = convByMintTx.get(txKey);
      const ref = depRef ?? (convRef ? {
        reference: convRef.reference,
        kind: 'fx_conversion',
        source: `${convRef.from_currency}/${convRef.to_currency}`,
      } : null);
      const party = a.to ?? a.from ?? '';
      const { code: token, decimals } = tokenForAddress(tokenRegistry, e.address);
      return { type: e.event_name, token, decimals, amount: a.amount ?? '0',
               party, partyName: labelForAddress(labels, party),
               reference: ref?.reference ?? null, refKind: ref?.kind ?? null,
               refSource: ref?.source ?? null, txHash: e.tx_hash, blockTime: e.block_time };
    });

    const totalsRows = await db.query<{ event_name: string; address: string; t: string }>(
      `SELECT event_name, address, SUM((args->>'amount')::numeric)::text t
         FROM chain_events WHERE event_name IN ('Minted','Burned') GROUP BY event_name, address`);
    const totalsByToken: Record<string, { Minted: string; Burned: string; decimals: number }> = {};
    for (const r of totalsRows.rows) {
      const { code, decimals } = tokenForAddress(tokenRegistry, r.address);
      if (!totalsByToken[code]) totalsByToken[code] = { Minted: '0', Burned: '0', decimals };
      totalsByToken[code][r.event_name as 'Minted' | 'Burned'] = r.t;
    }

    res.json({ events, totalsByToken });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

export default router;
