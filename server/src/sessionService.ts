// sessionService.ts — DB-backed session keys for SessionTransferModule payments.

import { ethers } from 'ethers';
import db from './db.js';
import config from './config.js';
import { sessionKeysEnabled } from './appFeatures.js';
import { currencyDecimals } from './currencyHelper.js';
import {
  buildAddSessionKeySafeTx,
  buildRemoveSessionKeySafeTx,
  buildEnableSessionModuleSafeTx,
  isSessionModuleEnabledOnSafe,
  relaySafeTx,
  relaySessionTransfer,
  getSessionNonce,
  getOnChainSession,
  sessionTransferModuleConfigured,
} from './safeRelayService.js';
import type { RawAssertion } from './safeWebAuthn.js';

const SESSION_TTL_SEC = 24 * 60 * 60; // 24h
// Vault caps are stored on-chain in 6-decimal units so USDC (6dp) compares correctly.
const SESSION_CAP_DECIMALS = 6;
// KYC1 pilot limits — major units (R5k / R20k daily, same numeric for USD).
const KYC1_MAX_MAJOR = 5000;
const KYC1_DAILY_MAJOR = 20000;

export interface ActiveSession {
  sessionAddress: string;
  expiresAt: Date;
  maxPerTx: bigint;
  dailyCap: bigint;
}

export async function sessionFeatureReady(): Promise<boolean> {
  if (!await sessionKeysEnabled()) return false;
  return sessionTransferModuleConfigured();
}

export async function getActiveSession(walletAddress: string): Promise<ActiveSession | null> {
  const result = await db.query<{
    session_address: string;
    expires_at: Date;
    max_per_tx: string;
    daily_cap: string;
  }>(
    `SELECT session_address, expires_at, max_per_tx, daily_cap
     FROM session_keys
     WHERE LOWER(wallet_address) = LOWER($1)
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [walletAddress],
  );
  const row = result.rows[0];
  if (!row) return null;

  if (await sessionNeedsRenewal(walletAddress, row.session_address)) return null;

  return {
    sessionAddress: row.session_address,
    expiresAt: row.expires_at,
    maxPerTx: BigInt(row.max_per_tx),
    dailyCap: BigInt(row.daily_cap),
  };
}

/** Normalize vault amount units to SESSION_CAP_DECIMALS for cross-currency cap checks. */
export function normalizeVaultAmount(amountUnits: bigint, currency: string): bigint {
  const dec = currencyDecimals(currency);
  if (dec === SESSION_CAP_DECIMALS) return amountUnits;
  if (dec > SESSION_CAP_DECIMALS) {
    return amountUnits / (10n ** BigInt(dec - SESSION_CAP_DECIMALS));
  }
  return amountUnits * (10n ** BigInt(SESSION_CAP_DECIMALS - dec));
}

export async function defaultSessionCaps(walletAddress: string): Promise<{ maxPerTx: bigint; dailyCap: bigint }> {
  // Pilot defaults — KYC1 limits in 6-decimal vault units (USDC-native scale).
  void walletAddress;
  return {
    maxPerTx: ethers.parseUnits(String(KYC1_MAX_MAJOR), SESSION_CAP_DECIMALS),
    dailyCap: ethers.parseUnits(String(KYC1_DAILY_MAJOR), SESSION_CAP_DECIMALS),
  };
}

export function sessionAmountWithinCaps(
  amountUnits: bigint,
  currency: string,
  caps: { maxPerTx: bigint; dailyCap: bigint },
): { ok: true } | { ok: false; reason: 'per_tx' | 'daily'; limit: bigint; amount: bigint } {
  const normalized = normalizeVaultAmount(amountUnits, currency);
  if (normalized > caps.maxPerTx) {
    return { ok: false, reason: 'per_tx', limit: caps.maxPerTx, amount: normalized };
  }
  // Daily spent is tracked on-chain; server only checks per-tx at prepare time.
  return { ok: true };
}

export async function sessionNeedsRenewal(walletAddress: string, sessionAddress: string): Promise<boolean> {
  const { maxPerTx } = await defaultSessionCaps(walletAddress);
  const onChain = await getOnChainSession(walletAddress, sessionAddress);
  if (!onChain.active) return true;
  return onChain.maxPerTx < maxPerTx;
}

export async function buildSessionStartPrepare(walletAddress: string, sessionAddress: string) {
  if (!await sessionFeatureReady()) {
    throw new Error('Session keys are not enabled or SESSION_TRANSFER_MODULE_ADDRESS is not configured');
  }
  if (!ethers.isAddress(sessionAddress)) throw new Error('Invalid session address');

  const moduleEnabled = await isSessionModuleEnabledOnSafe(walletAddress);
  if (!moduleEnabled) {
    const { safeTx, safeTxHash } = await buildEnableSessionModuleSafeTx({ safeAddress: walletAddress });
    return {
      step: 'enableModule' as const,
      safeTx,
      safeTxHash,
      sessionAddress,
    };
  }

  const expiry = BigInt(Math.floor(Date.now() / 1000) + SESSION_TTL_SEC);
  const { maxPerTx, dailyCap } = await defaultSessionCaps(walletAddress);

  const { safeTx, safeTxHash } = await buildAddSessionKeySafeTx({
    safeAddress: walletAddress,
    sessionKeyAddress: sessionAddress,
    expiry,
    maxPerTx,
    dailyCap,
  });

  return {
    step: 'addSessionKey' as const,
    safeTx,
    safeTxHash,
    sessionAddress,
    expiry: expiry.toString(),
    maxPerTx: maxPerTx.toString(),
    dailyCap: dailyCap.toString(),
  };
}

export async function relaySessionSetupTx(params: {
  walletAddress: string;
  ownerSignerAddress: string;
  safeTx: import('./safeRelayService.js').SafeTx;
  assertion: RawAssertion;
}): Promise<string> {
  return relaySafeTx({
    safeAddress: params.walletAddress,
    ownerSignerAddress: params.ownerSignerAddress,
    safeTx: params.safeTx,
    assertion: params.assertion,
    gasSource: 'session_enable',
  });
}

export async function completeSessionStart(params: {
  walletAddress: string;
  sessionAddress: string;
  ownerSignerAddress: string;
  safeTx: import('./safeRelayService.js').SafeTx;
  assertion: RawAssertion;
  expiry: string;
  maxPerTx: string;
  dailyCap: string;
}): Promise<string> {
  await db.query(
    `UPDATE session_keys SET revoked_at = NOW()
     WHERE LOWER(wallet_address) = LOWER($1) AND revoked_at IS NULL`,
    [params.walletAddress],
  );

  const txHash = await relaySafeTx({
    safeAddress: params.walletAddress,
    ownerSignerAddress: params.ownerSignerAddress,
    safeTx: params.safeTx,
    assertion: params.assertion,
    gasSource: 'session_add_key',
  });

  await db.query(
    `INSERT INTO session_keys (wallet_address, session_address, expires_at, max_per_tx, daily_cap)
     VALUES ($1, $2, to_timestamp($3::double precision), $4, $5)
     ON CONFLICT (wallet_address, session_address) DO UPDATE SET
       expires_at = EXCLUDED.expires_at,
       max_per_tx = EXCLUDED.max_per_tx,
       daily_cap = EXCLUDED.daily_cap,
       revoked_at = NULL,
       created_at = NOW()`,
    [params.walletAddress, params.sessionAddress, params.expiry, params.maxPerTx, params.dailyCap],
  );

  return txHash;
}

export async function buildSessionRevokePrepare(walletAddress: string, sessionAddress: string) {
  if (!await sessionFeatureReady()) throw new Error('Session keys are not enabled');
  return buildRemoveSessionKeySafeTx({ safeAddress: walletAddress, sessionKeyAddress: sessionAddress });
}

export async function completeSessionRevoke(params: {
  walletAddress: string;
  sessionAddress: string;
  ownerSignerAddress: string;
  safeTx: import('./safeRelayService.js').SafeTx;
  assertion: RawAssertion;
}): Promise<string> {
  const txHash = await relaySafeTx({
    safeAddress: params.walletAddress,
    ownerSignerAddress: params.ownerSignerAddress,
    safeTx: params.safeTx,
    assertion: params.assertion,
    gasSource: 'session_revoke',
  });
  await db.query(
    `UPDATE session_keys SET revoked_at = NOW()
     WHERE LOWER(wallet_address) = LOWER($1) AND LOWER(session_address) = LOWER($2)`,
    [params.walletAddress, params.sessionAddress],
  );
  return txHash;
}

export async function relaySessionPayment(params: {
  walletAddress: string;
  sessionAddress: string;
  toAddress: string;
  amount: bigint;
  currency: string;
  deadline: bigint;
  signature: string;
}): Promise<string> {
  return relaySessionTransfer(params);
}

export async function nextSessionTransferNonce(walletAddress: string, sessionAddress: string): Promise<bigint> {
  return getSessionNonce(walletAddress, sessionAddress);
}
