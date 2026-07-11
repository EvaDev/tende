// session.ts — ephemeral secp256k1 session key for cheaper payment relays.

import { Wallet, SigningKey, Signature } from 'ethers';
import { api } from './api';
import { getPasskeyAssertion } from './passkey';

const STORAGE_KEY = 'imali_session_key';

interface StoredSession {
  privateKey: string;
  address: string;
  expiresAt: string;
}

interface SessionPrepareResponse {
  step: 'enableModule' | 'addSessionKey';
  safeTxHash: string;
  challenge: string;
  rpId: string;
  sessionAddress: string;
  expiry?: string;
  maxPerTx?: string;
  dailyCap?: string;
}

export function getStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function saveSession(privateKey: string, address: string, expiresAt: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ privateKey, address, expiresAt }));
}

export async function sessionKeysFeatureEnabled(): Promise<boolean> {
  try {
    const cfg = await api.get<Record<string, string>>('/config');
    return cfg['feature.session_keys'] === 'true';
  } catch {
    return false;
  }
}

export async function fetchSessionStatus(): Promise<{ enabled: boolean; active: boolean; sessionAddress: string | null }> {
  return api.get('/consumer/session/status');
}

async function signAndSubmitSessionStep(
  prepared: SessionPrepareResponse,
  wallet: Wallet,
): Promise<{ step: string; expiresAt?: string }> {
  const assertion = await getPasskeyAssertion({ challenge: prepared.challenge, rpId: prepared.rpId });
  return api.post('/consumer/session/start/submit', {
    step: prepared.step,
    safeTxHash: prepared.safeTxHash,
    sessionAddress: wallet.address,
    credentialId: assertion.credentialId,
    authenticatorData: assertion.authenticatorData,
    clientDataJSON: assertion.clientDataJSON,
    signature: assertion.signature,
    expiry: prepared.expiry,
    maxPerTx: prepared.maxPerTx,
    dailyCap: prepared.dailyCap,
  });
}

export async function ensurePaymentSession(): Promise<StoredSession | null> {
  if (!await sessionKeysFeatureEnabled()) return null;

  const status = await fetchSessionStatus();
  if (!status.enabled) return null;

  const stored = getStoredSession();
  if (status.active && stored) return stored;

  // Stale local session or outdated on-chain caps — start fresh.
  clearStoredSession();

  const wallet = Wallet.createRandom();

  let prepared = await api.post<SessionPrepareResponse>(
    '/consumer/session/start/prepare',
    { sessionAddress: wallet.address },
  );

  // Legacy Safes: one-time enableModule passkey tx, then addSessionKey.
  if (prepared.step === 'enableModule') {
    await signAndSubmitSessionStep(prepared, wallet);
    prepared = await api.post<SessionPrepareResponse>(
      '/consumer/session/start/prepare',
      { sessionAddress: wallet.address },
    );
  }

  if (prepared.step !== 'addSessionKey' || !prepared.expiry) {
    throw new Error('Session setup failed — could not register session key');
  }

  const result = await signAndSubmitSessionStep(prepared, wallet);
  const expiresAt = result.expiresAt ?? new Date(Number(prepared.expiry) * 1000).toISOString();
  saveSession(wallet.privateKey, wallet.address, expiresAt);
  return getStoredSession();
}

export function signSessionTransferDigest(digest: string, privateKey: string): string {
  const key = new SigningKey(privateKey);
  const sig = key.sign(digest);
  return Signature.from(sig).serialized;
}
