// lib/pay.ts
// User-signed P2P transfer over the Vault unified ledger. The backend builds the
// SafeTx (Vault.transfer) and returns its hash as a WebAuthn challenge; the device
// passkey signs it; the backend relays execTransaction and pays the gas. The
// passkey private key never leaves the device — the client only runs the ceremony.

import { api } from './api';
import { getPasskeyAssertion } from './passkey';

export interface PreparedTransfer {
  safeTxHash: string;
  challenge: string;   // base64url(safeTxHash) — the WebAuthn challenge
  rpId: string;
  to: string;          // resolved recipient wallet
  amount: string;      // echoed back (display)
  currency: string;
  nonce: string;
}

export interface TransferResult {
  success: boolean;
  txHash: string;
  to: string;
  amount: string;
  currency: string;
}

// Optional merchant-purchase context — sent with a Buy-flow payment so the backend
// records it in the merchant sales ledger. Ignored for ordinary P2P sends.
export interface SalePayload {
  merchantId?: string;
  storeNumber?: string;
  tillNumber?: string;
  lat?: number;
  lng?: number;
  items?: { name: string; qty: number; unitPrice: number }[];
}

/// Step 1 — ask the backend to build the transfer and return the hash to sign.
export function prepareTransfer(input: { to: string; amount: string; currency: string; sale?: SalePayload }): Promise<PreparedTransfer> {
  return api.post<PreparedTransfer>('/consumer/transfer/prepare', input);
}

/// Step 2 — sign the SafeTx hash with the passkey and relay it. Triggers the
/// device biometric prompt. Returns the on-chain relay transaction hash.
export async function signAndSubmitTransfer(prepared: PreparedTransfer): Promise<TransferResult> {
  const assertion = await getPasskeyAssertion({ challenge: prepared.challenge, rpId: prepared.rpId });
  return api.post<TransferResult>('/consumer/transfer/submit', {
    safeTxHash:        prepared.safeTxHash,
    credentialId:      assertion.credentialId,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON:    assertion.clientDataJSON,
    signature:         assertion.signature,
  });
}

// ── Escrow send (to a phone number, shared via WhatsApp) ──────────────────────

export interface EscrowResult {
  success: boolean;
  txHash: string;
  claimUrl: string;    // recipient claim landing page
  waLink: string;      // wa.me deep-link to share to the recipient's number
  expiresAt: string;
  amount: string;
  currency: string;
}

/// Step 1 — build the sender→escrow transfer for a not-yet-onboarded recipient.
export function prepareEscrow(input: { recipientPhone: string; amount: string; currency?: string }): Promise<PreparedTransfer> {
  return api.post<PreparedTransfer>('/consumer/transfer/escrow/prepare', input);
}

/// Step 2 — sign + relay the escrow transfer; returns the WhatsApp share link.
export async function signAndSubmitEscrow(prepared: PreparedTransfer): Promise<EscrowResult> {
  const assertion = await getPasskeyAssertion({ challenge: prepared.challenge, rpId: prepared.rpId });
  return api.post<EscrowResult>('/consumer/transfer/escrow/submit', {
    safeTxHash:        prepared.safeTxHash,
    credentialId:      assertion.credentialId,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON:    assertion.clientDataJSON,
    signature:         assertion.signature,
  });
}
