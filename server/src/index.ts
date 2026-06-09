// src/index.ts
// Express entry point. Mounts all routes, adds middleware, starts listening.

import express       from 'express';
import cors          from 'cors';
import config        from './config.js';
import db            from './db.js';
import authRouter         from './auth.routes.js';
import registrationRouter from './registration.routes.js';
import consumerRouter     from './consumer.routes.js';
import systemRouter       from './system.routes.js';
import merchantsRouter    from './merchants.routes.js';
import productsRouter     from './products.routes.js';

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

app.use('/api/auth',      authRouter);
app.use('/api/register',  registrationRouter);
app.use('/api/consumer',  consumerRouter);
app.use('/api/system',    systemRouter);
app.use('/api/merchants', merchantsRouter);
app.use('/api/products',  productsRouter);

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
