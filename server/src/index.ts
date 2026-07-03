// src/index.ts
// Express entry point. Mounts all routes, adds middleware, starts listening.

import express       from 'express';
import cors          from 'cors';
import config        from './config.js';
import db            from './db.js';

// ── In-memory log ring buffer + SSE broadcast ─────────────────────────────────
// Each entry carries a `source` so the one Logs feed can mix backend logs with
// future client-reported errors (admin/consumer) — see POST /api/client-log.
const LOG_BUFFER: { ts: string; level: string; source: string; msg: string }[] = [];
const LOG_MAX = 500;
const logClients = new Set<import('http').ServerResponse>();

function pushLog(level: string, msg: string, source = 'server') {
  const entry = { ts: new Date().toISOString(), level, source, msg };
  LOG_BUFFER.push(entry);
  if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.shift();
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const c of logClients) { try { c.write(data); } catch { logClients.delete(c); } }
}

const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log   = (...a) => { _origLog(...a);   pushLog('info',  a.map(String).join(' ')); };
console.warn  = (...a) => { _origWarn(...a);  pushLog('warn',  a.map(String).join(' ')); };
console.error = (...a) => { _origError(...a); pushLog('error', a.map(String).join(' ')); };
import authRouter         from './auth.routes.js';
import registrationRouter from './registration.routes.js';
import consumerRouter     from './consumer.routes.js';
import systemRouter       from './system.routes.js';
import merchantsRouter    from './merchants.routes.js';
import productsRouter     from './products.routes.js';
import configRouter      from './config.routes.js';
import adminRouter       from './admin.routes.js';
import referenceRouter   from './reference.routes.js';
import reportsRouter     from './reports.routes.js';
import claimRouter       from './claim.routes.js';
import memberAuthRouter  from './memberAuth.routes.js';
import settlementRouter  from './settlement.routes.js';
import merchantSelfRouter from './merchantSelf.routes.js';
import { startIndexer }  from './indexerService.js';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin:      config.server.env === 'production' ? 'https://app.imali.app' : true,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', env: config.server.env });
  } catch (err) {
    res.status(503).json({ status: 'error', db: (err as Error).message });
  }
});

// idOS issuer discovery endpoint — idOS stores this URI to identify us as an issuer.
// Returns our encryption public key so consumers can encrypt data for us.
app.get('/idos', (_req, res) => {
  res.json({
    issuer:                  config.idos.issuerUri,
    encryptionPublicKey:     process.env['IDOS_ISSUER_ENCRYPTION_PUBLIC_KEY'] ?? '',
    multibasePublicKey:      config.idos.issuerMultibasePublic,
    supportedCredentials:    ['KYC_BASIC'],
  });
});

app.use('/api/auth',      authRouter);
app.use('/api/register',  registrationRouter);
app.use('/api/consumer',  consumerRouter);
app.use('/api/system',    systemRouter);
app.use('/api/merchants', merchantsRouter);
app.use('/api/products',  productsRouter);
app.use('/api/config',    configRouter);
app.use('/api/admin',         adminRouter);
app.use('/api/admin/reports', reportsRouter);
app.use('/api/claim',         claimRouter);
app.use('/api/member-auth',   memberAuthRouter);
app.use('/api/settlement',    settlementRouter);
app.use('/api/merchant',      merchantSelfRouter);
app.use('/api',               referenceRouter);

// ── Server-Sent Events log stream ─────────────────────────────────────────────
app.get('/api/admin/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  // Send recent history
  for (const entry of LOG_BUFFER) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
  logClients.add(res);
  req.on('close', () => logClients.delete(res));
});

app.get('/api/admin/logs/history', (_req, res) => {
  res.json(LOG_BUFFER);
});

// ── Client error reporting ────────────────────────────────────────────────────
// Frontends (admin/consumer) POST runtime errors here so they surface in the same
// Logs feed, tagged by source. Public (consumers are unauthenticated) and kept
// lightweight: validated enums + capped message. Best-effort — could be rate-
// limited later if abused.
const CLIENT_SOURCES = new Set(['admin', 'consumer']);
const CLIENT_LEVELS  = new Set(['info', 'warn', 'error']);

app.post('/api/client-log', (req, res) => {
  const { source, level, message } = (req.body ?? {}) as { source?: string; level?: string; message?: string };
  const msg = String(message ?? '').slice(0, 1000);
  if (!msg) { res.status(400).json({ error: 'message required' }); return; }
  const src = CLIENT_SOURCES.has(source ?? '') ? source! : 'client';
  const lvl = CLIENT_LEVELS.has(level ?? '')  ? level!  : 'error';
  pushLog(lvl, msg, src);
  res.status(204).end();
});

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const server = app.listen(config.server.port, () => {
  console.log(`[server] iMali API listening on port ${config.server.port} (${config.server.env})`);
  console.log(`[server] Routes: /health  /api/auth  /api/register  /api/consumer  /api/system  /api/merchants  /api/products  /api/config  /api/admin`);
});

// Background on-chain event indexer (projects logs → chain_events for reporting).
const indexerTimer = startIndexer();

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;            // ignore repeated signals
  shuttingDown = true;
  console.log(`[server] ${signal} received — shutting down`);

  if (indexerTimer) clearInterval(indexerTimer);

  // End long-lived SSE log streams FIRST — otherwise their keep-alive sockets
  // block server.close() forever, the process never exits, and tsx-watch (or a
  // launcher) force-kills it, leaking orphaned processes that hold DB connections.
  for (const c of logClients) { try { c.end(); } catch { /* ignore */ } }
  logClients.clear();

  server.close(async () => {
    try { await db.end(); } catch { /* ignore */ }
    console.log('[server] closed');
    process.exit(0);
  });

  // Hard cap so a lingering socket can never wedge shutdown.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
