// Admin-facing routes for the iMali admin console.
// Aliases existing routes and adds admin-only aggregation endpoints.

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import db from './db.js';
import config from './config.js';
import { requireAdmin, allowPublicPage } from './admin.middleware.js';
import dexQuoteService from './dexQuoteService.js';
import { getHarvestableYield, harvestYield, mintUsdcToVault } from './treasuryService.js';
import { reclaimExpiredClaims } from './escrowService.js';
import { cashIn } from './cashInService.js';

const router = express.Router();

// Gate the whole admin router with requireAdmin, EXCEPT a small allowlist of
// read-only endpoints that feed pages visible to everyone (the public Dashboard
// counts + reference lists + the live Logs feed). Everything else — all writes,
// and reads tied to admin-only pages (treasury, paymaster, registration-fields) —
// needs the admin JWT. Per-route requireAdmin on already-gated handlers is harmless.
// NOTE: `app.use('/api/admin', adminRouter)` prefix-matches /api/admin/logs, so this
// guard runs for the SSE logs feed too (defined on `app` in index.ts) — it must be
// allowlisted here or it 401s before reaching its handler.
const PUBLIC_ADMIN_READS = new Set([
  '/stats', '/merchants', '/products', '/consumers',
  '/countries', '/currencies', '/kyc-levels', '/icons',
]);
// GET reads whose auth is decided downstream by allowPublicPage (page-level opt-in
// via app.public_pages). They must bypass this blanket admin guard so their per-route
// middleware runs — that middleware still falls back to requireAdmin when the page
// isn't public, so auth is preserved. `/reports` also falls through to the separate
// reports router mounted at /api/admin/reports.
const PAGE_GATED_READS = (path: string) =>
  path.startsWith('/reports') ||
  path === '/contract-deployments' ||
  path === '/assets' ||
  path === '/asset-metadata';
router.use((req: Request, res: Response, next): void => {
  const isPublicRead = req.method === 'GET' && (
    PUBLIC_ADMIN_READS.has(req.path) ||
    PAGE_GATED_READS(req.path) ||       // defer to per-route allowPublicPage
    req.path.startsWith('/icons/') ||   // icon image bytes
    req.path.startsWith('/logs')   ||   // live SSE log feed + history
    /\/logo$/.test(req.path)            // merchant logo image
  );
  if (isPublicRead) { next(); return; }
  requireAdmin(req, res, next);
});

// Resolve a recipient given a 0x address or an @tag (ENS subdomain registered on
// the Consumer contract). Used by the dev tools so an operator can target "se1".
async function resolveWalletOrTag(input: string): Promise<string> {
  const v = (input || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return ethers.getAddress(v);
  const tag = v.replace(/^@/, '').toLowerCase().split('.')[0];
  if (!/^[a-z0-9-]{3,32}$/.test(tag)) throw new Error('Enter a 0x address or @tag');
  if (!config.contracts.consumer) throw new Error('Consumer contract not configured');
  const consumer = new ethers.Contract(
    config.contracts.consumer,
    ['function getConsumerByEns(bytes32 ensHash) view returns (tuple(address spendWallet,address saveWallet,address usdWallet,bytes32 displayNameHash,bytes32 ensSubdomainHash,bytes32 countryCode,uint8 kycLevel,bool isActive,uint256 globalConsumerId))'],
    new ethers.JsonRpcProvider(config.chain.rpcUrl),
  );
  try {
    const d = await consumer.getConsumerByEns(ethers.keccak256(ethers.toUtf8Bytes(tag)));
    return d.spendWallet as string;
  } catch {
    throw new Error(`No account found for @${tag}`);
  }
}

// ── Vault yield harvesting (admin-only) ───────────────────────────────────────
// GET  /api/admin/harvestable?currency=ZAR  — preview the harvestable yield
// POST /api/admin/harvest { currency, platformFeeBps?, treasuryAddress? } — execute
//
// The admin JWT gates WHO may trigger this; the on-chain harvest is signed by the
// backend wallet (ADMIN_EXECUTOR_ROLE). The platform cut defaults to the owner
// treasury (PLATFORM_TREASURY_ADDRESS / DEPLOYER_ADMIN_ADDRESS).

router.get('/harvestable', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const currency = String(req.query.currency ?? '').trim();
  if (!currency) { res.status(400).json({ error: 'currency required' }); return; }
  try {
    res.json({ currency: currency.toUpperCase(), harvestable: await getHarvestableYield(currency) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post('/harvest', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { currency, platformFeeBps, treasuryAddress } = req.body as
    { currency?: string; platformFeeBps?: number; treasuryAddress?: string };
  if (!currency) { res.status(400).json({ error: 'currency required' }); return; }
  try {
    const result = await harvestYield(currency, { platformFeeBps, treasuryAddress });
    res.json({ currency: currency.toUpperCase(), ...result });
  } catch (err) {
    // NoYield and other contract reverts surface here as a 502 with the reason.
    res.status(502).json({ error: (err as Error).message });
  }
});

// ── Contract deployments (admin-only) ─────────────────────────────────────────
// Returns the recorded deployments enriched with the LIVE implementation address
// (read from the ERC-1967 slot) and the on-chain VERSION() if the deployed logic
// exposes it. requireAdmin → only the connected admin wallet's JWT can read this.

const ERC1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const VERSION_ABI = ['function VERSION() view returns (string)'];

router.get('/contract-deployments', allowPublicPage('contracts'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = (await db.query(
      `SELECT contract_name, proxy_address, impl_address, version, chain_id, deploy_tx, deployed_at, notes
       FROM contract_deployments ORDER BY contract_name`,
    )).rows as Array<Record<string, unknown>>;

    const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);

    const enriched = await Promise.all(rows.map(async (r) => {
      const proxy = String(r.proxy_address);
      let liveImpl: string | null = null;
      let onChainVersion: string | null = null;
      try {
        const slot = await provider.getStorage(proxy, ERC1967_IMPL_SLOT);
        const addr = ethers.getAddress(ethers.dataSlice(slot, 12)); // last 20 bytes
        liveImpl = addr === ethers.ZeroAddress ? null : addr;
      } catch { /* not a proxy / RPC issue */ }
      try {
        onChainVersion = await new ethers.Contract(proxy, VERSION_ABI, provider).VERSION() as string;
      } catch { /* deployed logic predates VERSION() */ }
      return { ...r, liveImpl, onChainVersion };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Tradeable assets (admin-only management) ──────────────────────────────────
const ERC20_META_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

function rpcForChain(chainId: number): string {
  if (chainId === 1) return config.chain.mainnetRpcUrl;
  return config.chain.rpcUrl; // default to the configured chain (Sepolia)
}

// Read ERC-20 metadata so the admin doesn't have to type symbol/name/decimals.
router.get('/asset-metadata', allowPublicPage('assets'), async (req: Request, res: Response): Promise<void> => {
  const address = String(req.query.address ?? '');
  const chainId = parseInt(String(req.query.chainId ?? config.chain.chainId));
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { res.status(400).json({ error: 'Invalid address' }); return; }
  try {
    const provider = new ethers.JsonRpcProvider(rpcForChain(chainId));
    const c = new ethers.Contract(address, ERC20_META_ABI, provider);
    const [symbol, name, decimals] = await Promise.all([c.symbol(), c.name(), c.decimals()]);
    res.json({ symbol, name, decimals: Number(decimals), address: ethers.getAddress(address), chainId });
  } catch (err) {
    res.status(502).json({ error: `Could not read token on chain ${chainId}: ${(err as Error).message}` });
  }
});

// List all assets (admin view — includes disabled, enriched with live DEX price).
router.get('/assets', allowPublicPage('assets'), async (_req: Request, res: Response): Promise<void> => {
  const r = await db.query<Record<string, unknown>>(
    `SELECT * FROM tradeable_assets ORDER BY sort_order, symbol`,
  );
  const rows = await Promise.all(r.rows.map(async (a) => {
    if (a.price_source !== 'dex_quote') return { ...a, live_price_usd: a.price_usd != null ? Number(a.price_usd) : null };
    const q = await dexQuoteService.getPriceUsd({
      contract_address: String(a.contract_address), decimals: Number(a.decimals), pool_fee_tier: Number(a.pool_fee_tier),
    });
    return { ...a, live_price_usd: q.priceUsd };
  }));
  res.json(rows);
});

const ASSET_FIELDS = [
  'symbol','name','asset_class','contract_address','chain_id','decimals','issuer',
  'price_source','price_usd','price_ref','enabled','buy_enabled','sell_enabled',
  'min_trade_usd','max_trade_usd','min_kyc_tier','sort_order',
  'quote_token','pool_fee_tier','markup_bps',
] as const;

router.post('/assets', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.symbol || !b.name || !b.contract_address || !b.chain_id) {
      res.status(400).json({ error: 'symbol, name, contract_address, chain_id required' }); return;
    }
    const r = await db.query(
      `INSERT INTO tradeable_assets
         (symbol, name, asset_class, contract_address, chain_id, decimals, issuer,
          price_source, price_usd, price_ref, enabled, buy_enabled, sell_enabled,
          min_trade_usd, max_trade_usd, min_kyc_tier, sort_order, price_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               CASE WHEN $9 IS NULL THEN NULL ELSE NOW() END)
       RETURNING *`,
      [b.symbol, b.name, b.asset_class ?? 'COMMODITY', b.contract_address, b.chain_id,
       b.decimals ?? 18, b.issuer ?? null, b.price_source ?? 'manual', b.price_usd ?? null,
       b.price_ref ?? null, b.enabled ?? false, b.buy_enabled ?? true, b.sell_enabled ?? true,
       b.min_trade_usd ?? 0, b.max_trade_usd ?? null, b.min_kyc_tier ?? 0, b.sort_order ?? 0],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.patch('/assets/:id', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body as Record<string, unknown>;
    const keys = ASSET_FIELDS.filter(k => k in b);
    if (!keys.length) { res.status(400).json({ error: 'No updatable fields' }); return; }
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    // Stamp price_updated_at whenever the price changes.
    if ('price_usd' in b) sets.push('price_updated_at = NOW()');
    sets.push('updated_at = NOW()');
    const r = await db.query(
      `UPDATE tradeable_assets SET ${sets.join(', ')} WHERE asset_id = $1 RETURNING *`,
      [req.params.id, ...keys.map(k => b[k])],
    );
    if (!r.rowCount) { res.status(404).json({ error: 'Asset not found' }); return; }
    res.json(r.rows[0]);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [merchants, consumers, pending] = await Promise.all([
      db.query<{ count: string }>('SELECT COUNT(*) as count FROM merchants'),
      db.query<{ count: string }>('SELECT COUNT(*) as count FROM consumers'),
      db.query<{ count: string }>('SELECT COUNT(*) as count FROM consumers WHERE kyc_level_id = 0 OR kyc_level_id IS NULL'),
    ]);
    res.json({
      merchants:   parseInt(merchants.rows[0]?.count ?? '0'),
      consumers:   parseInt(consumers.rows[0]?.count ?? '0'),
      pendingKyc:  parseInt(pending.rows[0]?.count ?? '0'),
      totalVolume: 0,
    });
  } catch {
    res.json({ merchants: 0, consumers: 0, pendingKyc: 0, totalVolume: 0 });
  }
});

// ── Merchants ─────────────────────────────────────────────────────────────────

router.get('/merchants', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT merchant_id as id, name, wallet_address,
              verification_status as status, country_code, currency_code, icon_id, created_at
       FROM merchants ORDER BY created_at DESC`,
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/merchants', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, wallet_address, country_code } = req.body as {
      name: string; wallet_address: string; country_code: string;
    };
    // Derive currency_code from the country row
    const countryRow = await db.query<{ currency_code: string }>(
      `SELECT currency_code FROM countries WHERE country_code = $1`,
      [country_code.toUpperCase()],
    );
    const currency_code = countryRow.rows[0]?.currency_code ?? 'USD';
    const r = await db.query(
      `INSERT INTO merchants (name, wallet_address, country_code, currency_code, verification_status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       RETURNING merchant_id as id, name, wallet_address, country_code, currency_code, verification_status as status, created_at`,
      [name, wallet_address.toLowerCase(), country_code.toUpperCase(), currency_code],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── PATCH /api/admin/merchants/:id/status ─────────────────────────────────────
// Admin-controlled trading status (requireAdmin via the router guard — it's a
// non-GET, non-allowlisted path). Admins set PENDING → ACTIVE (trading) / INACTIVE.
// Admins do NOT edit a merchant's name/logo/icon — that's the merchant's own via
// the connected wallet (PATCH /api/merchants/me). Only verification_status changes.
router.patch('/merchants/:id/status', async (req: Request, res: Response): Promise<void> => {
  const VALID = ['PENDING', 'ACTIVE', 'INACTIVE'];
  const s = String((req.body as { status?: string }).status ?? '').toUpperCase();
  if (!VALID.includes(s)) { res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` }); return; }
  try {
    const r = await db.query(
      `UPDATE merchants SET verification_status = $2, updated_at = NOW()
       WHERE merchant_id = $1
       RETURNING merchant_id as id, name, verification_status as status`,
      [req.params.id, s],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Merchant not found' }); return; }
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Products ──────────────────────────────────────────────────────────────────

router.get('/products', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT p.product_id as id, p.merchant_id, m.name as merchant_name,
              p.name, p.currency_code as send_currency, p.country_code,
              p.min_price as min_amount, p.max_price as max_amount,
              p.icon_id, p.is_active as enabled, p.delivery_type
       FROM products p
       LEFT JOIN merchants m ON m.merchant_id = p.merchant_id
       ORDER BY p.created_at DESC`,
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/products', async (req: Request, res: Response): Promise<void> => {
  try {
    const { merchant_id, name, min_amount, max_amount, icon_id } = req.body as {
      merchant_id: string; name: string; min_amount?: number; max_amount?: number; icon_id?: number | null;
    };
    // Derive country_code and currency_code from the merchant
    const merchantRow = await db.query<{ country_code: string; currency_code: string }>(
      `SELECT country_code, currency_code FROM merchants WHERE merchant_id = $1`,
      [merchant_id],
    );
    if (!merchantRow.rows.length) { res.status(400).json({ error: 'Merchant not found' }); return; }
    const { country_code, currency_code } = merchantRow.rows[0];
    const r = await db.query(
      `INSERT INTO products (merchant_id, country_code, currency_code, name, min_price, max_price, icon_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       RETURNING product_id as id, merchant_id, name, currency_code as send_currency,
                 country_code, min_price as min_amount, max_price as max_amount, icon_id, is_active as enabled`,
      [merchant_id, country_code, currency_code, name, min_amount ?? 0, max_amount ?? 0, icon_id ?? null],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Consumers ─────────────────────────────────────────────────────────────────

router.get('/consumers', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT c.consumer_id as id, c.wallet_address, c.usd_wallet_address as safe_address,
              c.kyc_level_id as kyc_level, k.level_name as kyc_level_name, c.ens_subdomain,
              c.idos_credential_id IS NOT NULL as idos_profile, c.created_at
       FROM consumers c
       LEFT JOIN kyc_levels k ON k.level_id = c.kyc_level_id
       ORDER BY c.created_at DESC`,
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Countries ─────────────────────────────────────────────────────────────────

router.get('/countries', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT country_code as code, name, currency_code, dial_code,
              vat_rate_pct, is_active as send_enabled, is_active as receive_enabled
       FROM countries ORDER BY country_code`,
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/countries', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, name, currency_code, dial_code, send_enabled } = req.body as {
      code: string; name: string; currency_code?: string; dial_code?: string; send_enabled?: boolean;
    };
    const r = await db.query(
      `INSERT INTO countries (country_code, name, currency_code, dial_code, is_active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (country_code) DO UPDATE
         SET name=$2, currency_code=COALESCE($3, countries.currency_code),
             dial_code=COALESCE($4, countries.dial_code), is_active=$5
       RETURNING country_code as code, name, currency_code, dial_code, is_active as send_enabled`,
      [code.toUpperCase(), name, currency_code ?? 'USD', dial_code ?? '', send_enabled ?? true],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Currencies ────────────────────────────────────────────────────────────────

router.get('/currencies', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT c.currency_code as code, c.name, c.currency_symbol as symbol,
              c.decimals, c.currency_type, c.is_active as enabled,
              s.contract_address as token_address
       FROM currencies c
       LEFT JOIN stablecoins s ON s.currency_code = c.currency_code
       ORDER BY c.currency_type, c.currency_code`,
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/currencies', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, name, symbol, decimals, currency_type } = req.body as {
      code: string; name: string; symbol?: string; decimals?: number; currency_type?: string;
    };
    const r = await db.query(
      `INSERT INTO currencies (currency_code, name, currency_symbol, decimals, currency_type)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (currency_code) DO UPDATE
         SET name=$2, currency_symbol=COALESCE($3, currencies.currency_symbol),
             decimals=COALESCE($4, currencies.decimals),
             currency_type=COALESCE($5, currencies.currency_type)
       RETURNING currency_code as code, name, currency_symbol as symbol,
                 decimals, currency_type, is_active as enabled`,
      [code.toUpperCase(), name, symbol ?? code, decimals ?? 2, currency_type ?? 'FIAT'],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Icons ─────────────────────────────────────────────────────────────────────

router.get('/icons', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT icon_id, name, slug, mime_type, arweave_id FROM icons ORDER BY name`,
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/icons/:id/image', async (req: Request, res: Response): Promise<void> => {
  const r = await db.query(`SELECT mime_type, data_base64 FROM icons WHERE icon_id = $1`, [req.params.id]);
  if (!r.rows.length) { res.status(404).end(); return; }
  const { mime_type, data_base64 } = r.rows[0] as { mime_type: string; data_base64: string };
  const buf = Buffer.from(data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  res.setHeader('Content-Type', mime_type);
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.end(buf);
});

router.post('/icons', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, data_base64, mime_type } = req.body as { name: string; data_base64: string; mime_type?: string };
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '');
    const mime = mime_type ?? data_base64.match(/^data:([^;]+);/)?.[1] ?? 'image/png';
    const r = await db.query(
      `INSERT INTO icons (name, slug, mime_type, data_base64)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO UPDATE SET data_base64=$4, mime_type=$3
       RETURNING icon_id, name, slug`,
      [name, slug, mime, data_base64],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Assign icon to merchant or product
router.patch('/merchants/:id/icon', async (req: Request, res: Response): Promise<void> => {
  try {
    const { icon_id } = req.body as { icon_id: number | null };
    await db.query(`UPDATE merchants SET icon_id=$1 WHERE merchant_id=$2`, [icon_id, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.patch('/products/:id/icon', async (req: Request, res: Response): Promise<void> => {
  try {
    const { icon_id } = req.body as { icon_id: number | null };
    await db.query(`UPDATE products SET icon_id=$1 WHERE product_id=$2`, [icon_id, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ── Logos ─────────────────────────────────────────────────────────────────────

router.get('/merchants/:id/logo', async (req: Request, res: Response): Promise<void> => {
  const r = await db.query(
    `SELECT mime_type, data_base64 FROM merchant_logos WHERE merchant_id = $1`,
    [req.params.id],
  );
  if (!r.rows.length) { res.status(404).json({ error: 'No logo' }); return; }
  const { mime_type, data_base64 } = r.rows[0] as { mime_type: string; data_base64: string };
  const buf = Buffer.from(data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  res.setHeader('Content-Type', mime_type);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(buf);
});

router.put('/merchants/:id/logo', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data_base64, mime_type } = req.body as { data_base64: string; mime_type?: string };
    if (!data_base64) { res.status(400).json({ error: 'data_base64 required' }); return; }
    const mime = mime_type ?? data_base64.match(/^data:([^;]+);/)?.[1] ?? 'image/png';
    await db.query(
      `INSERT INTO merchant_logos (merchant_id, mime_type, data_base64)
       VALUES ($1,$2,$3)
       ON CONFLICT (merchant_id) DO UPDATE
         SET mime_type=$2, data_base64=$3, updated_at=NOW()`,
      [req.params.id, mime, data_base64],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── KYC Levels ───────────────────────────────────────────────────────────────

router.get('/kyc-levels', async (req: Request, res: Response): Promise<void> => {
  try {
    const country = req.query.country as string | undefined;
    const r = await db.query(
      `SELECT level_id, country_code, level_name,
              max_single_tx, max_daily_send, max_monthly_spend, max_wallet_balance,
              requires_full_name, requires_mobile,
              requires_id_doc, requires_biometric, allows_remittance,
              allows_usd_savings, idos_credential_required
       FROM kyc_levels
       ${country ? 'WHERE country_code = $1' : ''}
       ORDER BY country_code, level_id`,
      country ? [country.toUpperCase()] : [],
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/kyc-levels/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      max_single_tx, max_daily_send, max_monthly_spend, max_wallet_balance,
      requires_full_name, requires_mobile,
      requires_id_doc, requires_biometric, allows_remittance,
      allows_usd_savings, idos_credential_required,
    } = req.body as Record<string, unknown>;
    const r = await db.query(
      `UPDATE kyc_levels SET
         max_single_tx            = COALESCE($1, max_single_tx),
         max_daily_send           = COALESCE($2, max_daily_send),
         max_monthly_spend        = COALESCE($3, max_monthly_spend),
         max_wallet_balance       = COALESCE($4, max_wallet_balance),
         requires_full_name       = COALESCE($5, requires_full_name),
         requires_mobile          = COALESCE($6, requires_mobile),
         requires_id_doc          = COALESCE($7, requires_id_doc),
         requires_biometric       = COALESCE($8, requires_biometric),
         allows_remittance        = COALESCE($9, allows_remittance),
         allows_usd_savings       = COALESCE($10, allows_usd_savings),
         idos_credential_required = COALESCE($11, idos_credential_required),
         updated_at               = NOW()
       WHERE level_id = $12
       RETURNING *`,
      [max_single_tx, max_daily_send, max_monthly_spend, max_wallet_balance,
       requires_full_name, requires_mobile,
       requires_id_doc, requires_biometric, allows_remittance,
       allows_usd_savings, idos_credential_required, id],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Level not found' }); return; }
    res.json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/kyc-levels', async (req: Request, res: Response): Promise<void> => {
  try {
    const { country_code, level_name, max_single_tx, max_daily_send, max_monthly_spend } = req.body as {
      country_code: string; level_name: string;
      max_single_tx?: number; max_daily_send?: number; max_monthly_spend?: number;
    };
    const r = await db.query(
      `INSERT INTO kyc_levels (country_code, level_name, max_single_tx, max_daily_send, max_monthly_spend)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [country_code.toUpperCase(), level_name, max_single_tx ?? 0, max_daily_send ?? 0, max_monthly_spend ?? 0],
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Treasury ──────────────────────────────────────────────────────────────────

// Live on-chain treasury supplies as a DATA-DRIVEN list, so new treasury tokens
// appear automatically (no per-token code change). Each row = a deployed treasury
// token's totalSupply (minted − burned = outstanding), plus the Vault's USDC
// holding. Reads are best-effort — a failed read falls back to '0'.
// kind: 'treasury' = a closed-loop token WE mint (show as minted supply);
//       'vault'    = an asset the platform HOLDS in the Vault (underlying holding).
interface SupplyRow { token: string; label: string; address: string; decimals: number; supply: string; kind: 'treasury' | 'vault'; }

router.get('/treasury', async (_req: Request, res: Response): Promise<void> => {
  const vaultAddr = process.env['VAULT_CONTRACT_ADDRESS'] ?? config.contracts.vault;
  const provider  = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const erc20 = (addr: string) => new ethers.Contract(
    addr,
    ['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
    provider,
  );

  // Treasury tokens from the stablecoins registry (data-driven).
  let rows: Array<{ code: string; address: string; decimals: number }> = [];
  try {
    const q = await db.query<{ code: string; address: string; decimals: number }>(
      `SELECT s.internal_code AS code, s.contract_address AS address, cu.decimals
         FROM stablecoins s JOIN currencies cu ON cu.currency_code = s.internal_code
        WHERE s.is_treasury_token = TRUE AND s.is_deployed = TRUE AND s.contract_address IS NOT NULL
        ORDER BY s.internal_code`,
    );
    rows = q.rows;
  } catch { /* stablecoins table absent — fall through to env fallback */ }
  // Fallback so the page isn't empty if the registry isn't seeded.
  if (rows.length === 0 && (config.contracts.treasuryTokenZA)) {
    rows = [{ code: 'TTZA', address: config.contracts.treasuryTokenZA, decimals: 2 }];
  }

  const supplies: SupplyRow[] = await Promise.all(rows.map(async (r) => {
    let supply = '0';
    let decimals = r.decimals ?? 2;
    try {
      const c = erc20(r.address);
      supply = ((await c.totalSupply()) as bigint).toString();
      decimals = Number(await c.decimals());   // on-chain decimals is authoritative (DB may differ)
    } catch { /* keep defaults */ }
    return { token: r.code, label: `${r.code} Supply`, address: r.address, decimals, supply, kind: 'treasury' as const };
  }));

  // Vault USDC holding (the reserve's USD leg).
  let vaultUsdc = '0';
  if (vaultAddr) {
    try {
      const vault = new ethers.Contract(vaultAddr, ['function usdcToken() view returns (address)'], provider);
      const usdc  = await vault.usdcToken() as string;
      vaultUsdc = ((await erc20(usdc).balanceOf(vaultAddr)) as bigint).toString();
    } catch { /* keep 0 */ }
  }
  supplies.push({ token: 'USDC', label: 'Vault USDC', address: vaultAddr ?? '', decimals: 6, supply: vaultUsdc, kind: 'vault' });

  res.json({ supplies, dev_tools: config.server.env !== 'production' });
});

// ── Dev cash-in (POC ONLY — must not ship to production) ──────────────────────
// Sepolia has no real fiat rail, so this simulates a deposit: mint TTZA bank-cash
// backing into the Vault and credit the recipient's spendable Vault ZAR balance
// (the unified-ledger claim consumers actually hold and send — they never hold
// the treasury token directly). Hard-gated to non-production environments.
router.post('/treasury/dev-credit', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  if (config.server.env === 'production') {
    res.status(403).json({ error: 'Dev cash-in is disabled in production' });
    return;
  }
  try {
    const { to, amount, reference } = req.body as { to?: string; amount?: string; reference?: string };
    if (!to || !amount) { res.status(400).json({ error: 'recipient (0x or @tag) and amount required' }); return; }

    let recipient: string;
    try { recipient = await resolveWalletOrTag(to); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

    let units: bigint;
    try { units = ethers.parseUnits(String(amount), 2); } catch { res.status(400).json({ error: 'Invalid amount' }); return; }
    if (units <= 0n) { res.status(400).json({ error: 'Amount must be positive' }); return; }

    // Bank-deposit reference backs the mint (auto-generated if the admin leaves it blank).
    const ref = String(reference ?? '').trim() || `DEV-${Date.now()}`;
    const r = await cashIn({ wallet: recipient, amountUnits: units, currency: 'ZAR', reference: ref, kind: 'bank_deposit', source: 'admin' });

    res.json({ success: true, to: recipient, amount: String(amount), reference: ref, mintTx: r.mintTx, creditTx: r.creditTx });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 500) console.error('[POST /api/admin/treasury/dev-credit]', err);
    res.status(status).json({ error: (err as Error).message });
  }
});

// ── Dev: simulate a USDC reserve purchase (POC ONLY) ──────────────────────────
// Grows the platform's USD reserve by minting the Vault's mock USDC into the Vault.
// This is the USD analogue of dev cash-in (which mints TTZA for the ZAR reserve).
// On mainnet this would be a real USDC purchase (fiat→USDC via an exchange/OTC) or
// an on-chain swap. Records an audit reference. Hard-gated to non-production.
router.post('/treasury/buy-usdc', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  if (config.server.env === 'production') {
    res.status(403).json({ error: 'Simulated USDC purchase is disabled in production' });
    return;
  }
  try {
    const { amount, reference } = req.body as { amount?: string; reference?: string };
    if (!amount) { res.status(400).json({ error: 'amount (USD) required' }); return; }

    let units: bigint;   // USDC is 6dp
    try { units = ethers.parseUnits(String(amount), 6); } catch { res.status(400).json({ error: 'Invalid amount' }); return; }
    if (units <= 0n) { res.status(400).json({ error: 'Amount must be positive' }); return; }

    const ref = String(reference ?? '').trim() || `USDC-${Date.now()}`;
    const vaultAddr = (process.env['VAULT_CONTRACT_ADDRESS'] ?? config.contracts.vault ?? '').toLowerCase();

    // Reserve the reference first (uniqueness gate), then mint the reserve.
    let depId: string;
    try {
      const r = await db.query<{ id: string }>(
        `INSERT INTO deposit_references (reference, kind, source, wallet, amount, currency)
         VALUES ($1,'usdc_purchase','admin',$2,$3,'USDC') RETURNING id`,
        [ref, vaultAddr, units.toString()],
      );
      depId = r.rows[0].id;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') { res.status(409).json({ error: 'That reference has already been used' }); return; }
      throw e;
    }

    const { mintTx, usdc } = await mintUsdcToVault(units);
    await db.query(`UPDATE deposit_references SET mint_tx = $1 WHERE id = $2`, [mintTx, depId]);

    res.json({ success: true, amount: String(amount), currency: 'USDC', reference: ref, usdc, mintTx });
  } catch (err) {
    console.error('[POST /api/admin/treasury/buy-usdc]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Dev: set a consumer's KYC level (POC ONLY) ────────────────────────────────
// Sets the on-chain Consumer.kycLevel (the Vault.transfer gate reads this) and
// mirrors it into the DB so the app's KYC display matches. Hard-disabled in prod.
// Backend holds KYC_UPDATER_ROLE. Recipient may be a 0x address or an @tag.
router.post('/consumers/kyc-level', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  if (config.server.env === 'production') { res.status(403).json({ error: 'Disabled in production' }); return; }
  try {
    const { wallet, level } = req.body as { wallet?: string; level?: number | string };
    const lvl = Number(level);
    if (!Number.isInteger(lvl) || lvl < 0 || lvl > 3) { res.status(400).json({ error: 'level must be 0–3' }); return; }
    if (!wallet) { res.status(400).json({ error: 'wallet (0x or @tag) required' }); return; }

    let recipient: string;
    try { recipient = await resolveWalletOrTag(wallet); }
    catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

    if (!config.contracts.consumer || !config.backend.privateKey) { res.status(500).json({ error: 'Consumer/backend not configured' }); return; }
    const signer   = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
    const consumer = new ethers.Contract(config.contracts.consumer, ['function updateKycLevel(address wallet, uint8 newLevel)'], signer);
    const tx       = await consumer.updateKycLevel(recipient, lvl);
    const receipt  = await tx.wait() as ethers.TransactionReceipt;

    // Mirror into the DB so /consumer/me reflects it (best-effort level→kyc_levels map).
    await db.query(
      `UPDATE consumers
         SET kyc_level_id = (SELECT level_id FROM kyc_levels
                             WHERE country_code = consumers.country_code AND level_name LIKE $2 LIMIT 1),
             updated_at = NOW()
       WHERE LOWER(wallet_address) = LOWER($1)`,
      [recipient, `Level ${lvl}%`],
    );

    res.json({ success: true, wallet: recipient, level: lvl, txHash: receipt.hash });
  } catch (err) {
    console.error('[POST /api/admin/consumers/kyc-level]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Escrow claims ─────────────────────────────────────────────────────────────
// Sweep expired WhatsApp claims, returning their escrowed value to the senders.
// Safe to call repeatedly (idempotent — only acts on still-pending, expired rows).
// Intended for a scheduled cron; exposed here for manual/admin triggering.
router.post('/claims/reclaim-expired', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await reclaimExpiredClaims();
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[POST /api/admin/claims/reclaim-expired]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/admin/escrow ─────────────────────────────────────────────────────
// Visibility over WhatsApp-escrow holdings. Value sits on-chain at the platform
// escrow address (commingled with the owner wallet); pending_claims is the
// breakdown. Surfaces each claim + the outstanding liability (still-pending value)
// per currency. requireAdmin via the router-level guard (not a public read).
router.get('/escrow', async (_req: Request, res: Response): Promise<void> => {
  try {
    const dec  = (cur: string) => (cur.toUpperCase() === 'USDC' || cur.toUpperCase() === 'USD' ? 6 : 2);
    const fmt  = (raw: string, cur: string) => ethers.formatUnits(BigInt(raw), dec(cur));
    // Mask the beneficiary phone for the ops view (keep prefix + last 2 digits).
    const mask = (p: string) => {
      const s = String(p ?? '');
      if (s.length <= 5) return s;
      return `${s.slice(0, 3)}••••${s.slice(-2)}`;
    };

    const rows = (await db.query<{
      id: string; sender_wallet: string; recipient_phone: string; amount: string;
      currency: string; status: string; escrow_tx: string | null; release_tx: string | null;
      expires_at: string; created_at: string;
    }>(
      `SELECT id, sender_wallet, recipient_phone, amount, currency, status,
              escrow_tx, release_tx, expires_at, created_at
         FROM pending_claims
        ORDER BY created_at DESC
        LIMIT 200`,
    )).rows;

    const claims = rows.map(r => ({
      id: r.id,
      sender: `${r.sender_wallet.slice(0, 6)}…${r.sender_wallet.slice(-4)}`,
      recipientMasked: mask(r.recipient_phone),
      amount: fmt(r.amount, r.currency),
      currency: r.currency.toUpperCase() === 'USDC' ? 'USD' : r.currency.toUpperCase(),
      status: r.status,
      escrowTx: r.escrow_tx,
      releaseTx: r.release_tx,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      expired: r.status === 'pending' && new Date(r.expires_at).getTime() < Date.now(),
    }));

    // Outstanding liability = still-pending value, summed per currency (raw units).
    const totalsRaw: Record<string, bigint> = {};
    for (const r of rows) {
      if (r.status !== 'pending') continue;
      const c = r.currency.toUpperCase() === 'USDC' ? 'USD' : r.currency.toUpperCase();
      totalsRaw[c] = (totalsRaw[c] ?? 0n) + BigInt(r.amount);
    }
    const outstanding = Object.entries(totalsRaw).map(([currency, raw]) => ({
      currency, amount: ethers.formatUnits(raw, currency === 'USD' ? 6 : 2),
    }));

    res.json({
      escrowAddress: process.env['ESCROW_ADDRESS'] ?? config.platform?.escrowAddress ?? null,
      counts: {
        pending:   rows.filter(r => r.status === 'pending').length,
        claimed:   rows.filter(r => r.status === 'claimed').length,
        reclaimed: rows.filter(r => r.status === 'reclaimed').length,
      },
      outstanding,
      claims,
    });
  } catch (err) {
    console.error('[GET /api/admin/escrow]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Paymaster ─────────────────────────────────────────────────────────────────

router.get('/paymaster', async (_req: Request, res: Response): Promise<void> => {
  const mode      = process.env['PIMLICO_MODE'] ?? 'stub';
  const policy_id = config.pimlico.sponsorshipPolicy;
  const base = { mode, policy_id };

  if (mode !== 'live') { res.json(base); return; }

  try {
    const r = await fetch(config.pimlico.bundlerUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.pimlico.apiKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pm_getBalance', params: [policy_id] }),
    });
    const json = await r.json() as { result?: { balance: string } };
    const balanceWei = json.result?.balance ?? '0';
    const balance_eth = (Number(BigInt(balanceWei)) / 1e18).toFixed(4);
    res.json({ ...base, balance_eth });
  } catch {
    res.json({ ...base, balance_eth: null });
  }
});

// ── Registration Config ───────────────────────────────────────────────────────

router.get('/registration-fields', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await db.query(
      `SELECT field_key, label, included, required, verification_method, sort_order
       FROM registration_fields ORDER BY sort_order`,
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/registration-fields/:key', async (req: Request, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    const { included, required, verification_method } = req.body as Record<string, unknown>;
    const r = await db.query(
      `UPDATE registration_fields SET
         included            = COALESCE($1, included),
         required            = COALESCE($2, required),
         verification_method = COALESCE($3, verification_method),
         updated_at          = NOW()
       WHERE field_key = $4
       RETURNING *`,
      [included, required, verification_method, key],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Field not found' }); return; }
    res.json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
