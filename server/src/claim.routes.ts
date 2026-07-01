// src/claim.routes.ts
// WhatsApp escrow claim endpoints.
//   GET  /api/claim/:secret          — public: claim summary for the landing page
//   POST /api/claim/:secret/redeem   — recipient (onboarded, JWT): release escrow → them
// The recipient flow: open the wa.me link → land here → register (passkey) → redeem.

import express, { Request, Response } from 'express';
import { requireAuth } from './auth.middleware.js';
import { getClaimBySecret, redeemClaim } from './escrowService.js';

const router = express.Router();

// Show only the last 3 digits of the beneficiary phone on the public summary.
function maskPhone(p: string): string {
  return p.length <= 3 ? p : `••• ${p.slice(-3)}`;
}

router.get('/:secret', async (req: Request, res: Response): Promise<void> => {
  try {
    const claim = await getClaimBySecret(String(req.params.secret));
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    res.json({
      status:        claim.status,
      amount:        claim.amount,
      currency:      claim.currency,
      senderWallet:  claim.sender_wallet,
      phoneHint:     maskPhone(claim.recipient_phone),
      expiresAt:     claim.expires_at,
      expired:       new Date(claim.expires_at).getTime() < Date.now(),
    });
  } catch (err) {
    console.error('[GET /api/claim/:secret]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/:secret/redeem', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { recipientPhone } = req.body as { recipientPhone?: string };
    if (!recipientPhone) { res.status(400).json({ error: 'recipientPhone required' }); return; }
    const r = await redeemClaim({
      secret:          String(req.params.secret),
      recipientWallet: req.consumer!.walletAddress,
      recipientPhone,
    });
    res.json({ success: true, ...r });
  } catch (err) {
    // Validation failures (expired, wrong phone, already claimed) are client errors.
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
