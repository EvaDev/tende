// lib/pay.ts
// User-signed P2P transfer over the Vault unified ledger.
// Default: passkey signs SafeTx → backend relays execTransaction (WebAuthn/P256).
// When feature.session_keys is on: session EOA signs → SessionTransferModule (~90k gas).

import { api } from './api';
import { getPasskeyAssertion } from './passkey';
import {
  ensurePaymentSession, getStoredSession, signSessionTransferDigest, sessionKeysFeatureEnabled,
} from './session';

export interface PasskeyPreparedTransfer {
  mode: 'passkey';
  safeTxHash: string;
  challenge: string;
  rpId: string;
  to: string;
  amount: string;
  currency: string;
  charge?: { amount: string; currency: string; fxRate?: number };
  nonce: string;
}

export interface SessionPreparedTransfer {
  mode: 'session';
  transferId: string;
  digest: string;
  deadline: string;
  sessionAddress: string;
  to: string;
  amount: string;
  currency: string;
  charge?: { amount: string; currency: string; fxRate?: number };
}

export type PreparedTransfer = PasskeyPreparedTransfer | SessionPreparedTransfer;

export interface TransferResult {
  success: boolean;
  txHash: string;
  to: string;
  amount: string;
  currency: string;
  saleId?: string;
  fulfilmentPending?: boolean;
  fulfilmentStatus?: string;
}

export interface SalePayload {
  merchantId?: string;
  productId?: string;
  storeId?: string;
  storeNumber?: string;
  tillNumber?: string;
  lat?: number;
  lng?: number;
  items?: { name: string; qty: number; unitPrice: number }[];
  chargeAmount?: string;
  chargeCurrency?: string;
}

export type TransferStep = 'prepare' | 'sign' | 'relay' | 'escrow' | 'fulfil' | 'done';

export function prepareTransfer(input: { to: string; amount: string; currency: string; sale?: SalePayload }): Promise<PreparedTransfer> {
  return api.post<PreparedTransfer>('/consumer/transfer/prepare', input);
}

export async function signAndSubmitTransfer(
  prepared: PreparedTransfer,
  onStep?: (step: TransferStep) => void,
): Promise<TransferResult> {
  if (prepared.mode === 'session') {
    onStep?.('sign');
    const stored = getStoredSession();
    if (!stored || stored.address.toLowerCase() !== prepared.sessionAddress.toLowerCase()) {
      throw new Error('Session key missing — please try again');
    }
    const sessionSignature = signSessionTransferDigest(prepared.digest, stored.privateKey);
    onStep?.('relay');
    const result = await api.post<TransferResult>('/consumer/transfer/submit', {
      transferId: prepared.transferId,
      sessionSignature,
    });
    return result;
  }

  onStep?.('sign');
  const assertion = await getPasskeyAssertion({ challenge: prepared.challenge, rpId: prepared.rpId });
  onStep?.('relay');
  const result = await api.post<TransferResult>('/consumer/transfer/submit', {
    safeTxHash:        prepared.safeTxHash,
    credentialId:      assertion.credentialId,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON:    assertion.clientDataJSON,
    signature:         assertion.signature,
  });
  return result;
}

export interface PurchaseStatus {
  saleId: string;
  status: string;
  fulfilmentStatus: string | null;
  fulfilmentError: string | null;
  amount: string;
  currency: string;
  merchantName: string | null;
}

/** Poll until the fulfilment API outcome is known (~30s mock), not until on-chain release. */
export async function waitForPurchaseFulfilment(
  saleId: string,
  onStep?: (step: TransferStep) => void,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<PurchaseStatus> {
  const timeoutMs = opts.timeoutMs ?? 50_000;
  const intervalMs = opts.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;
  onStep?.('escrow');
  await new Promise(r => setTimeout(r, 300));
  onStep?.('fulfil');

  while (Date.now() < deadline) {
    const status = await api.get<PurchaseStatus>(`/consumer/purchases/${saleId}`);
    const apiDone = status.fulfilmentStatus === 'success' || status.fulfilmentStatus === 'failed';
    const settled = status.status === 'paid' || status.status === 'refunded';
    if (apiDone || settled) return status;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return api.get<PurchaseStatus>(`/consumer/purchases/${saleId}`);
}

/// Prepare + submit in one call. Starts a session (one passkey prompt) when enabled.
export async function executeTransfer(
  input: { to: string; amount: string; currency: string; sale?: SalePayload },
  onStep?: (step: TransferStep) => void,
): Promise<TransferResult> {
  onStep?.('prepare');
  if (await sessionKeysFeatureEnabled()) {
    await ensurePaymentSession();
  }
  const prepared = await prepareTransfer(input);
  const result = await signAndSubmitTransfer(prepared, onStep);

  if (result.fulfilmentPending && result.saleId) {
    const fulfil = await waitForPurchaseFulfilment(result.saleId, onStep);
    onStep?.('done');
    const apiFailed = fulfil.fulfilmentStatus === 'failed' || fulfil.status === 'refunded';
    const apiOk = fulfil.fulfilmentStatus === 'success' || fulfil.status === 'paid';
    return {
      ...result,
      fulfilmentPending: !apiOk && !apiFailed,
      fulfilmentStatus: apiFailed ? 'refunded' : apiOk ? 'paid' : fulfil.status,
    };
  }

  onStep?.('done');
  return result;
}

// ── External USDC withdrawal (unknown 0x / MetaMask) ─────────────────────────

export interface TravelRuleBeneficiary {
  fullName: string;
  idNumber?: string;
  phone?: string;
  country?: string;
  relationship?: string;
}

export interface PreparedWithdrawal {
  withdrawalId: string;
  challenge: string;
  rpId: string;
  to: string;
  currency: 'USDC';
  gross: string;
  fee: string;
  net: string;
  feeBps: number;
  warning: string;
}

export interface WithdrawResult {
  success: boolean;
  txHash: string;
  to: string;
  amount: string;
  net: string;
  fee: string;
  currency: 'USDC';
}

export function prepareWithdraw(input: {
  to: string;
  amount: string;
  beneficiary: TravelRuleBeneficiary;
}): Promise<PreparedWithdrawal> {
  return api.post<PreparedWithdrawal>('/consumer/withdraw/prepare', input);
}

export async function executeWithdraw(
  input: { to: string; amount: string; beneficiary: TravelRuleBeneficiary },
  onStep?: (step: TransferStep) => void,
): Promise<WithdrawResult> {
  onStep?.('prepare');
  const prepared = await prepareWithdraw(input);
  onStep?.('sign');
  const assertion = await getPasskeyAssertion({ challenge: prepared.challenge, rpId: prepared.rpId });
  onStep?.('relay');
  const result = await api.post<WithdrawResult>('/consumer/withdraw/submit', {
    withdrawalId: prepared.withdrawalId,
    credentialId: assertion.credentialId,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON: assertion.clientDataJSON,
    signature: assertion.signature,
  });
  onStep?.('done');
  return result;
}

// ── Escrow (always passkey — no session path for phone escrow yet) ────────────

export interface EscrowPreparedTransfer {
  safeTxHash: string;
  challenge: string;
  rpId: string;
  to: string;
  amount: string;
  currency: string;
  nonce: string;
}

export interface EscrowResult {
  success: boolean;
  txHash: string;
  claimUrl: string;
  waLink: string;
  expiresAt: string;
  amount: string;
  currency: string;
}

export function prepareEscrow(input: { recipientPhone: string; amount: string; currency?: string }): Promise<EscrowPreparedTransfer> {
  return api.post<EscrowPreparedTransfer>('/consumer/transfer/escrow/prepare', input);
}

export async function signAndSubmitEscrow(
  prepared: EscrowPreparedTransfer,
  onStep?: (step: TransferStep) => void,
): Promise<EscrowResult> {
  onStep?.('sign');
  const assertion = await getPasskeyAssertion({ challenge: prepared.challenge, rpId: prepared.rpId });
  onStep?.('relay');
  const result = await api.post<EscrowResult>('/consumer/transfer/escrow/submit', {
    safeTxHash:        prepared.safeTxHash,
    credentialId:      assertion.credentialId,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON:    assertion.clientDataJSON,
    signature:         assertion.signature,
  });
  onStep?.('done');
  return result;
}
