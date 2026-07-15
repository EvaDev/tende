// src/mockFulfil.routes.ts
// Dev / demo endpoints: mock product fulfilment (50/50 after 30s) and a Flash PIM
// catalogue fixture for merchants without VPN access to the live PIM API.

import express, { Request, Response } from 'express';
import { loadFlashPimFixture } from './productCatalogService.js';
import { mockFulfilmentOutcome } from './fulfilmentService.js';

const router = express.Router();

const MOCK_DELAY_MS = 30_000;

// GET /api/mock/catalog/flash-pim — bundled Flash PIM channel-1 response
router.get('/mock/catalog/flash-pim', (_req: Request, res: Response): void => {
  try {
    res.json(loadFlashPimFixture());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/mock/fulfil — 30s delay, then ~50/50 success/failure
// Optional query: ?outcome=success|fail to force a result (useful in demos)
router.post('/mock/fulfil', async (req: Request, res: Response): Promise<void> => {
  const forced = String(req.query.outcome ?? '').toLowerCase();
  await new Promise(r => setTimeout(r, MOCK_DELAY_MS));

  let success: boolean;
  if (forced === 'success' || forced === 'ok') success = true;
  else if (forced === 'fail' || forced === 'failed' || forced === 'error') success = false;
  else success = mockFulfilmentOutcome().success;

  const bodyForce = (req.body as { force?: string })?.force;
  if (bodyForce === 'success') success = true;
  if (bodyForce === 'fail') success = false;

  res.json({
    success,
    status: success ? 'ok' : 'failed',
    message: success ? 'Mock fulfilment succeeded' : 'Mock fulfilment failed',
    delayMs: MOCK_DELAY_MS,
    request: {
      saleId: (req.body as { saleId?: string })?.saleId ?? null,
      amount: (req.body as { amount?: string })?.amount ?? null,
      currency: (req.body as { currency?: string })?.currency ?? null,
    },
  });
});

export default router;
