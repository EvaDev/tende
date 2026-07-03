// src/reports.routes.ts
// Admin reporting over the indexed chain_events (mounted at /api/admin/reports).
// The indexer is the data source (chain = truth); these endpoints are read-only
// projections for ops / compliance / revenue reporting.

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import db from './db.js';
import { allowPublicPage } from './admin.middleware.js';

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

// GET /api/admin/reports/transfers — value movements (the flow / Travel-Rule feed).
router.get('/transfers', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT block_number, block_time, tx_hash,
              args->>'from' AS "from", args->>'to' AS "to",
              args->>'amount' AS amount, args->>'currencyCode' AS currency_hash
       FROM chain_events WHERE event_name = 'Transferred'
       ORDER BY block_number DESC LIMIT 500`);
    res.json(r.rows.map(x => ({ ...x, currency: decodeCurrency(x.currency_hash) })));
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
    res.json(r.rows.map(x => ({ currency: decodeCurrency(x.currency_hash), platformCut: x.platform_cut, harvests: x.harvests })));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/conversion-fees — platform revenue from FX conversions (the
// spread). The fee is retained in the reserve (the consumer is credited the
// post-spread amount); it's recorded per-conversion in consumer_conversions.
router.get('/conversion-fees', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query<{ fee_currency: string; total_fee: string; total_from: string; conversions: number }>(
      `SELECT fee_currency,
              SUM(fee_amount)::numeric  AS total_fee,
              SUM(from_amount)::numeric AS total_from,
              count(*)::int             AS conversions
         FROM consumer_conversions GROUP BY fee_currency`);
    // fee_currency is ZAR (2dp minor units) for now — convert to major units for display.
    res.json(r.rows.map(x => ({
      feeCurrency:    x.fee_currency,
      conversions:    x.conversions,
      totalFee:       (Number(x.total_fee)  / 100).toFixed(2),
      totalConverted: (Number(x.total_from) / 100).toFixed(2),
    })));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// GET /api/admin/reports/registrations — the sign-up funnel. Attempts are recorded
// before any on-chain work (registration_attempts), so failed / abandoned sign-ups
// are counted here — unlike the consumers table, which only holds completed ones.
// This is what reconciles on-chain ConsumerRegistered events vs consumers rows: the
// difference is attempts that reached 'deploy' but failed before writing the DB row.
router.get('/registrations', allowPublicPage('reports'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const totals = await db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int n FROM registration_attempts GROUP BY status`);
    const byFailedStep = await db.query<{ failed_step: string | null; n: number }>(
      `SELECT failed_step, count(*)::int n FROM registration_attempts
        WHERE status = 'failed' GROUP BY failed_step ORDER BY n DESC`);
    const recentFailures = await db.query(
      `SELECT attempt_id, failed_step, error, ens_subdomain, country_code,
              wallet_address, created_at
         FROM registration_attempts
        WHERE status = 'failed'
        ORDER BY created_at DESC LIMIT 50`);

    const byStatus: Record<string, number> = {};
    for (const r of totals.rows) byStatus[r.status] = r.n;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    res.json({
      total,
      completed:      byStatus.completed ?? 0,
      failed:         byStatus.failed ?? 0,
      started:        byStatus.started ?? 0,   // never finished — crashed or in-flight
      byFailedStep:   byFailedStep.rows,
      recentFailures: recentFailures.rows,
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
        netValue:     netRaw / 10 ** dec,   // numeric, for client-side sorting
        users:        r.users,
        lastActivity: r.last_activity,
      };
    }).sort((a, b) => b.netValue - a.netValue);

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
    const evs = await db.query<{ block_time: string; tx_hash: string; event_name: string; args: Record<string, string> }>(
      `SELECT block_time, tx_hash, event_name, args
         FROM chain_events
        WHERE event_name IN ('Minted','Burned','UsdPurchased')
        ORDER BY block_number DESC, log_index DESC LIMIT 500`);

    // Off-chain references, keyed by the mint tx they back.
    const refs = await db.query<{ mint_tx: string; reference: string; kind: string; source: string }>(
      `SELECT lower(mint_tx) AS mint_tx, reference, kind, source FROM deposit_references WHERE mint_tx IS NOT NULL`);
    const refByTx: Record<string, { reference: string; kind: string; source: string }> = {};
    for (const r of refs.rows) refByTx[r.mint_tx] = { reference: r.reference, kind: r.kind, source: r.source };

    const events = evs.rows.map((e) => {
      const a = e.args ?? {};
      if (e.event_name === 'UsdPurchased') {
        return { type: 'Asset purchase', token: 'USDC', decimals: 6, amount: a.usdcReceived ?? '0',
                 spent: a.localAmount ?? '0', spentCurrency: decodeCurrency(a.localCurrency), spentDecimals: 2,
                 party: a.buyer ?? '', reference: null, refKind: null, refSource: null,
                 txHash: e.tx_hash, blockTime: e.block_time };
      }
      const ref = refByTx[String(e.tx_hash).toLowerCase()];
      return { type: e.event_name, token: 'TTZA', decimals: 2, amount: a.amount ?? '0',
               party: a.to ?? a.from ?? '', reference: ref?.reference ?? null, refKind: ref?.kind ?? null,
               refSource: ref?.source ?? null, txHash: e.tx_hash, blockTime: e.block_time };
    });

    const totalsRows = await db.query<{ event_name: string; t: string }>(
      `SELECT event_name, SUM((args->>'amount')::numeric)::text t
         FROM chain_events WHERE event_name IN ('Minted','Burned') GROUP BY event_name`);
    const totals: Record<string, string> = {};
    for (const r of totalsRows.rows) totals[r.event_name] = r.t;

    res.json({ events, totals }); // totals in TTZA raw units (2dp)
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

export default router;
