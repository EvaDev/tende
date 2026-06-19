// src/authNonce.ts
// Shared sign-in nonce store: issue a one-time message for a wallet, then verify
// a signature recovers that wallet and consume the nonce. Used by wallet login
// and by merchant self-registration (proving wallet ownership before creating a row).
// In-memory + 5-min TTL; replace with Redis for multi-instance.

import { ethers } from 'ethers';

interface NonceEntry { message: string; expiresAt: number }
const store = new Map<string, NonceEntry>();
const TTL_MS = 5 * 60 * 1000;

export function issueNonce(walletRaw: string): { nonce: string; message: string; expiresAt: number } {
  const wallet = walletRaw.toLowerCase();
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);

  const nonce     = ethers.hexlify(ethers.randomBytes(16));
  const message   = `Sign in to iMali\nWallet: ${wallet}\nNonce: ${nonce}`;
  const expiresAt = now + TTL_MS;
  store.set(wallet, { message, expiresAt });
  return { nonce, message, expiresAt };
}

// Verifies the signature against the issued nonce and consumes it (single use).
export function verifyAndConsume(walletRaw: string, signature: string): boolean {
  const wallet = walletRaw.toLowerCase();
  const entry  = store.get(wallet);
  if (!entry || entry.expiresAt < Date.now()) { store.delete(wallet); return false; }
  let recovered: string;
  try { recovered = ethers.verifyMessage(entry.message, signature); } catch { return false; }
  if (recovered.toLowerCase() !== wallet) return false;
  store.delete(wallet);
  return true;
}
