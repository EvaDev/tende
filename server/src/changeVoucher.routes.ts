import express, { Request, Response } from 'express';
import { requireAuth } from './auth.middleware.js';
import { getChangeVoucherSummary, redeemChangeVoucher } from './changeVoucherService.js';

const router = express.Router();

router.get('/:secret', async (req: Request, res: Response): Promise<void> => {
  try {
    const summary = await getChangeVoucherSummary(String(req.params.secret));
    if (!summary) { res.status(404).json({ error: 'Change voucher not found' }); return; }
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:secret/redeem', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await redeemChangeVoucher(String(req.params.secret), req.consumer!.walletAddress);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    res.status(status).json({ error: (err as Error).message });
  }
});

export default router;
