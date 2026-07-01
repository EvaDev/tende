// src/escrowService.ts
// Phase-1 WhatsApp escrow: value sent to a not-yet-onboarded recipient is held at
// the custodial escrow address (an on-chain Vault balance, moved there by the
// sender's own signed Vault.transfer). This module owns the claim lifecycle:
//   create  — after the sender→escrow transfer lands, mint a secret + DB record
//   lookup  — recipient's claim landing page reads the claim by secret
//   redeem  — release escrow → recipient (custodial: adminDebit escrow + adminCredit)
//   reclaim — sweep expired claims back to the sender
//
// Beneficiary binding (Phase 1) is a phone-number match — OTP-ready: when a
// messaging provider is wired, replace the match with a verified one-time code.
// NOTE: release is two non-atomic admin txs (debit then credit). Phase-2 replaces
// this with an atomic Vault.adminTransfer (see project_value_model pending #5).

import crypto from 'crypto';
import db from './db.js';
import config from './config.js';
import { vaultAdminCredit, vaultAdminDebit } from './treasuryService.js';

const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function escrowAddress(): string {
  const a = config.platform.escrowAddress;
  if (!a) throw new Error('No escrow address configured (PLATFORM_ESCROW_ADDRESS)');
  return a;
}

function hashSecret(secret: string): string {
  return '0x' + crypto.createHash('sha256').update(secret).digest('hex');
}
function normalizePhone(p: string): string {
  return p.replace(/[^\d+]/g, '');
}

export interface PendingClaim {
  id: string; sender_wallet: string; recipient_phone: string;
  amount: string; currency: string; status: string;
  escrow_tx: string | null; release_tx: string | null;
  claimed_by: string | null; expires_at: string;
}

/// Create a claim after the sender→escrow transfer has landed. Returns the secret
/// (ONLY here — we persist its hash) so the caller can build the wa.me link.
export async function createClaim(p: {
  senderWallet: string; recipientPhone: string; amount: bigint; currency: string; escrowTx: string;
}): Promise<{ secret: string; expiresAt: string }> {
  const secret = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
  await db.query(
    `INSERT INTO pending_claims
       (secret_hash, sender_wallet, recipient_phone, amount, currency, escrow_tx, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [hashSecret(secret), p.senderWallet.toLowerCase(), normalizePhone(p.recipientPhone),
     p.amount.toString(), p.currency.toUpperCase(), p.escrowTx, expiresAt],
  );
  return { secret, expiresAt };
}

/// Public lookup by secret (the recipient's claim landing page).
export async function getClaimBySecret(secret: string): Promise<PendingClaim | null> {
  const r = await db.query<PendingClaim>(
    `SELECT id, sender_wallet, recipient_phone, amount::text AS amount, currency, status,
            escrow_tx, release_tx, claimed_by, expires_at
     FROM pending_claims WHERE secret_hash = $1`,
    [hashSecret(secret)],
  );
  return r.rows[0] ?? null;
}

/// Release escrow → recipient. Phone-match beneficiary binding (OTP-ready).
export async function redeemClaim(p: {
  secret: string; recipientWallet: string; recipientPhone: string;
}): Promise<{ releaseTx: string; amount: string; currency: string }> {
  const claim = await getClaimBySecret(p.secret);
  if (!claim) throw new Error('Claim not found');
  if (claim.status !== 'pending') throw new Error(`Claim already ${claim.status}`);
  if (new Date(claim.expires_at).getTime() < Date.now()) throw new Error('Claim has expired');
  if (normalizePhone(p.recipientPhone) !== claim.recipient_phone) {
    throw new Error('Phone number does not match this claim');
  }

  // Custodial release (debit escrow first so a partial failure can't create value).
  await vaultAdminDebit(escrowAddress(), BigInt(claim.amount), claim.currency);
  const releaseTx = await vaultAdminCredit(p.recipientWallet, BigInt(claim.amount), claim.currency);

  await db.query(
    `UPDATE pending_claims SET status='claimed', claimed_by=$1, release_tx=$2, updated_at=NOW()
     WHERE secret_hash=$3 AND status='pending'`,
    [p.recipientWallet.toLowerCase(), releaseTx, hashSecret(p.secret)],
  );
  return { releaseTx, amount: claim.amount, currency: claim.currency };
}

/// Sweep expired pending claims and return their value to the senders.
export async function reclaimExpiredClaims(): Promise<{ reclaimed: number }> {
  const r = await db.query<{ id: string; sender_wallet: string; amount: string; currency: string }>(
    `SELECT id, sender_wallet, amount::text AS amount, currency
     FROM pending_claims WHERE status='pending' AND expires_at < NOW()`,
  );
  let reclaimed = 0;
  for (const c of r.rows) {
    try {
      await vaultAdminDebit(escrowAddress(), BigInt(c.amount), c.currency);
      const tx = await vaultAdminCredit(c.sender_wallet, BigInt(c.amount), c.currency);
      await db.query(
        `UPDATE pending_claims SET status='reclaimed', release_tx=$1, updated_at=NOW()
         WHERE id=$2 AND status='pending'`,
        [tx, c.id],
      );
      reclaimed++;
    } catch (e) {
      console.error('[reclaimExpiredClaims] failed for claim', c.id, (e as Error).message);
    }
  }
  return { reclaimed };
}
