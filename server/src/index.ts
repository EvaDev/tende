// src/index.ts
// Express entry point. Mounts all routes, adds middleware, starts listening.

import express       from 'express';
import cors          from 'cors';
import config        from './config.js';
import db            from './db.js';

// ── In-memory log ring buffer + SSE broadcast ─────────────────────────────────
const LOG_BUFFER: { ts: string; level: string; msg: string }[] = [];
const LOG_MAX = 500;
const logClients = new Set<import('http').ServerResponse>();

function pushLog(level: string, msg: string) {
  const entry = { ts: new Date().toISOString(), level, msg };
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
app.use('/api/admin',     adminRouter);
app.use('/api',           referenceRouter);

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
  console.log(`[server] Routes: /health  /api/auth  /api/register  /api/consumer  /api/system  /api/merchants  /api/products`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — shutting down`);
  server.close(async () => {
    await db.end();
    console.log('[server] closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
