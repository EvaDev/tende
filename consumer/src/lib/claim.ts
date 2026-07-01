// lib/claim.ts
// Recipient side of the WhatsApp escrow flow: read a claim, then redeem it after
// the recipient has onboarded (passkey → JWT). The value is released from the
// custodial escrow to the recipient's wallet by the backend.

import { api } from './api';

export interface ClaimSummary {
  status: 'pending' | 'claimed' | 'reclaimed';
  amount: string;       // raw units (ZAR = 2dp)
  currency: string;
  senderWallet: string;
  phoneHint: string;    // masked beneficiary phone
  expiresAt: string;
  expired: boolean;
}

export interface RedeemResult {
  success: boolean;
  releaseTx: string;
  amount: string;
  currency: string;
}

/// Public — read a claim's summary for the landing page.
export function getClaim(secret: string): Promise<ClaimSummary> {
  return api.get<ClaimSummary>(`/claim/${secret}`);
}

/// Recipient (logged in) — release the escrow to their wallet. The phone must
/// match what the sender specified (Phase-1 beneficiary binding).
export function redeemClaim(secret: string, recipientPhone: string): Promise<RedeemResult> {
  return api.post<RedeemResult>(`/claim/${secret}/redeem`, { recipientPhone });
}
