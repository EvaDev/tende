// withdrawalService.ts — consumer USDC withdrawals to external EOAs (MetaMask etc.).
// Uses Vault.withdrawToExternal (admin executor). Fee retained as platform USDC claim.

import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import config from './config.js';
import db from './db.js';
import { getRevenueConfig, calcWithdrawalFeeUnits } from './revenueConfig.js';
import {
  assertKycSendAllowed,
  recordSpendEvent,
} from './kycSpendService.js';
import {
  vaultBalanceOf,
  vaultAdminDebit,
  vaultAdminCredit,
  vaultBackingTokenForCurrency,
  vaultErc20Balance,
  withdrawToExternal,
} from './treasuryService.js';
import { isRegisteredConsumer, isTrustedCounterparty } from './safeRelayService.js';
import { registerChallenge, bufToB64url, verifyAssertion, b64urlToBuf } from './webauthnService.js';
import { recordGasFromTxHash } from './gasCostService.js';

const PENDING_TTL_MS = 5 * 60 * 1000;

const RELATIONSHIPS = new Set([
  'immediate_family', 'extended_family', 'friend', 'employee', 'employer',
  'business_partner', 'self', 'other',
]);

export interface TravelRuleBeneficiary {
  fullName: string;
  idNumber?: string;
  phone?: string;
  country?: string;
  relationship?: string;
}

export interface PendingWithdrawal {
  withdrawalId: string;
  consumerId: string;
  fromWallet: string;
  toAddress: string;
  grossUnits: bigint;
  feeUnits: bigint;
  netUnits: bigint;
  feeBps: number;
  challenge: string;
  amountLimitUnits: bigint;
  beneficiary: TravelRuleBeneficiary;
  expiry: number;
}

const pending = new Map<string, PendingWithdrawal>();

function sweep(): void {
  const now = Date.now();
  for (const [id, p] of pending) if (p.expiry < now) pending.delete(id);
}

function isHexAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

function cleanStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s) return undefined;
  return s.slice(0, max);
}

/** Validate and normalise Travel Rule beneficiary details declared by the sender. */
export function parseTravelRuleBeneficiary(raw: unknown): TravelRuleBeneficiary {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const fullName = cleanStr(o.fullName ?? o.name, 200);
  if (!fullName || fullName.length < 2) {
    throw Object.assign(
      new Error('Recipient full name is required for Travel Rule compliance'),
      { status: 400, code: 'TRAVEL_RULE_NAME_REQUIRED' },
    );
  }
  const idNumber = cleanStr(o.idNumber, 64);
  const phone = cleanStr(o.phone, 32);
  let country = cleanStr(o.country, 2)?.toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) {
    throw Object.assign(new Error('Recipient country must be a 2-letter ISO code'), { status: 400, code: 'INVALID_COUNTRY' });
  }
  let relationship = cleanStr(o.relationship, 32)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (relationship && !RELATIONSHIPS.has(relationship)) {
    throw Object.assign(new Error('Invalid recipient relationship'), { status: 400, code: 'INVALID_RELATIONSHIP' });
  }
  return { fullName, idNumber, phone, country, relationship };
}

export interface WithdrawPrepareResult {
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

export async function prepareWithdrawal(params: {
  consumerId: string;
  fromWallet: string;
  to: string;
  amount: string;
  beneficiary: TravelRuleBeneficiary | unknown;
}): Promise<WithdrawPrepareResult> {
  sweep();
  const beneficiary = parseTravelRuleBeneficiary(params.beneficiary);
  const toAddress = params.to.trim();
  if (!isHexAddress(toAddress)) {
    throw Object.assign(new Error('Destination must be a 0x wallet address'), { status: 400, code: 'INVALID_ADDRESS' });
  }
  if (toAddress.toLowerCase() === params.fromWallet.toLowerCase()) {
    throw Object.assign(new Error('Cannot withdraw to yourself'), { status: 400 });
  }

  const [registered, trusted] = await Promise.all([
    isRegisteredConsumer(toAddress),
    isTrustedCounterparty(toAddress),
  ]);
  if (trusted) {
    throw Object.assign(
      new Error('That address is a platform address (escrow/treasury), not an external wallet'),
      { status: 409, code: 'PLATFORM_ADDRESS' },
    );
  }
  if (registered) {
    throw Object.assign(
      new Error('This address is an iMali wallet — use Send (internal transfer) instead'),
      { status: 409, code: 'USE_INTERNAL_TRANSFER' },
    );
  }

  let grossUnits: bigint;
  try { grossUnits = ethers.parseUnits(String(params.amount), 6); }
  catch {
    throw Object.assign(new Error('Invalid amount'), { status: 400 });
  }
  if (grossUnits <= 0n) {
    throw Object.assign(new Error('Amount must be positive'), { status: 400 });
  }

  const kyc = await assertKycSendAllowed({
    consumerId: params.consumerId,
    walletAddress: params.fromWallet,
    amountUnits: grossUnits,
    currency: 'USDC',
    spendType: 'withdrawal',
  });
  if (!kyc.ok) {
    throw Object.assign(new Error(kyc.error), { status: 403, code: kyc.code });
  }

  const balance = await vaultBalanceOf(params.fromWallet, 'USDC');
  if (balance < grossUnits) {
    throw Object.assign(new Error('Insufficient USDC balance'), { status: 409, code: 'INSUFFICIENT_BALANCE' });
  }

  const revenue = await getRevenueConfig();
  const { feeUnits, netUnits } = calcWithdrawalFeeUnits(grossUnits, revenue.withdrawalFeeBps);

  const token = await vaultBackingTokenForCurrency('USDC');
  const inventory = await vaultErc20Balance(token);
  if (inventory < netUnits) {
    throw Object.assign(
      new Error('Platform USDC reserves are temporarily insufficient for this withdrawal'),
      { status: 503, code: 'INSUFFICIENT_RESERVES' },
    );
  }

  const treasury = config.platform.treasuryAddress;
  if (!treasury || !isHexAddress(treasury)) {
    throw Object.assign(new Error('Platform treasury not configured'), { status: 500 });
  }

  const withdrawalId = randomUUID();
  const intentHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'string'],
      [
        'imali.withdraw.v1', params.fromWallet, toAddress, grossUnits, feeUnits, netUnits,
        BigInt(revenue.withdrawalFeeBps), beneficiary.fullName,
      ],
    ),
  );
  const challenge = bufToB64url(Buffer.from(ethers.getBytes(intentHash)));
  registerChallenge(challenge);

  const row: PendingWithdrawal = {
    withdrawalId,
    consumerId: params.consumerId,
    fromWallet: params.fromWallet,
    toAddress: ethers.getAddress(toAddress),
    grossUnits,
    feeUnits,
    netUnits,
    feeBps: revenue.withdrawalFeeBps,
    challenge,
    amountLimitUnits: kyc.amountLimitUnits,
    beneficiary,
    expiry: Date.now() + PENDING_TTL_MS,
  };
  pending.set(withdrawalId, row);

  await db.query(
    `INSERT INTO consumer_withdrawals
       (id, consumer_id, from_wallet, to_address, gross_units, fee_units, net_units, fee_bps, currency, status,
        recipient_name, recipient_id_number, recipient_phone, recipient_country, recipient_relationship)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'USDC', 'pending', $9, $10, $11, $12, $13)`,
    [
      withdrawalId, params.consumerId, params.fromWallet.toLowerCase(), row.toAddress.toLowerCase(),
      grossUnits.toString(), feeUnits.toString(), netUnits.toString(), revenue.withdrawalFeeBps,
      beneficiary.fullName,
      beneficiary.idNumber ?? null,
      beneficiary.phone ?? null,
      beneficiary.country ?? null,
      beneficiary.relationship ?? null,
    ],
  ).catch(e => console.error('[prepareWithdrawal] DB insert non-fatal:', (e as Error).message));

  return {
    withdrawalId,
    challenge,
    rpId: config.webauthn.rpId,
    to: row.toAddress,
    currency: 'USDC',
    gross: ethers.formatUnits(grossUnits, 6),
    fee: ethers.formatUnits(feeUnits, 6),
    net: ethers.formatUnits(netUnits, 6),
    feeBps: revenue.withdrawalFeeBps,
    warning: 'External withdrawals are irreversible. Double-check the destination address and recipient details.',
  };
}

export interface WithdrawSubmitResult {
  success: true;
  txHash: string;
  to: string;
  amount: string;
  net: string;
  fee: string;
  currency: 'USDC';
}

export async function submitWithdrawal(params: {
  consumerId: string;
  fromWallet: string;
  withdrawalId: string;
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}): Promise<WithdrawSubmitResult> {
  sweep();
  const row = pending.get(params.withdrawalId);
  if (!row || row.expiry < Date.now()) {
    throw Object.assign(new Error('Withdrawal expired — please start again'), { status: 410, code: 'EXPIRED' });
  }
  if (row.consumerId !== params.consumerId || row.fromWallet.toLowerCase() !== params.fromWallet.toLowerCase()) {
    throw Object.assign(new Error('Withdrawal does not belong to this account'), { status: 403 });
  }

  const cred = await db.query<{
    wallet_address: string;
    pub_key_x: string;
    pub_key_y: string;
    sign_count: string;
  }>(
    `SELECT wallet_address, pub_key_x, pub_key_y, sign_count FROM webauthn_credentials WHERE credential_id = $1`,
    [params.credentialId],
  );
  const c = cred.rows[0];
  if (!c) throw Object.assign(new Error('Unknown passkey credential'), { status: 404 });
  if (c.wallet_address.toLowerCase() !== row.fromWallet.toLowerCase()) {
    throw Object.assign(new Error('Credential does not match the sending wallet'), { status: 403 });
  }

  // Bind challenge to this intent (verifyAssertion also consumes the registered challenge).
  const clientData = JSON.parse(b64urlToBuf(params.clientDataJSON).toString('utf8')) as { challenge?: string };
  if ((clientData.challenge ?? '') !== row.challenge) {
    throw Object.assign(new Error('Signed challenge does not match this withdrawal'), { status: 400 });
  }

  const { signCount } = verifyAssertion({
    authenticatorDataB64: params.authenticatorData,
    clientDataJSONb64: params.clientDataJSON,
    signatureB64: params.signature,
    pubKeyX: BigInt(c.pub_key_x),
    pubKeyY: BigInt(c.pub_key_y),
  });
  const prev = Number(c.sign_count);
  if (signCount !== 0 && prev !== 0 && signCount <= prev) {
    throw Object.assign(new Error('Passkey counter regression'), { status: 401 });
  }
  await db.query(
    `UPDATE webauthn_credentials SET sign_count = $1, last_used_at = NOW() WHERE credential_id = $2`,
    [signCount, params.credentialId],
  );

  // Re-check balances / inventory under auth (prepare may be stale).
  const balance = await vaultBalanceOf(row.fromWallet, 'USDC');
  if (balance < row.grossUnits) {
    throw Object.assign(new Error('Insufficient USDC balance'), { status: 409, code: 'INSUFFICIENT_BALANCE' });
  }
  const token = await vaultBackingTokenForCurrency('USDC');
  const inventory = await vaultErc20Balance(token);
  if (inventory < row.netUnits) {
    throw Object.assign(new Error('Platform USDC reserves are temporarily insufficient'), {
      status: 503, code: 'INSUFFICIENT_RESERVES',
    });
  }

  const treasury = config.platform.treasuryAddress!;
  pending.delete(params.withdrawalId);

  let withdrawTx = '';
  let feeDebitTx: string | null = null;
  let feeCreditTx: string | null = null;
  try {
    // Net ERC-20 out to external wallet (also debits net claim).
    withdrawTx = await withdrawToExternal(row.fromWallet, row.toAddress, token, row.netUnits);
    await recordGasFromTxHash(withdrawTx, 'consumer_withdraw').catch(() => {});

    if (row.feeUnits > 0n) {
      feeDebitTx = await vaultAdminDebit(row.fromWallet, row.feeUnits, 'USDC');
      await recordGasFromTxHash(feeDebitTx, 'consumer_withdraw_fee_debit').catch(() => {});
      feeCreditTx = await vaultAdminCredit(treasury, row.feeUnits, 'USDC');
      await recordGasFromTxHash(feeCreditTx, 'consumer_withdraw_fee_credit').catch(() => {});
    }

    await db.query(
      `UPDATE consumer_withdrawals
          SET status = 'executed', withdraw_tx = $1, fee_debit_tx = $2, fee_credit_tx = $3, executed_at = NOW()
        WHERE id = $4`,
      [withdrawTx, feeDebitTx, feeCreditTx, params.withdrawalId],
    ).catch(e => console.error('[submitWithdrawal] DB update non-fatal:', (e as Error).message));

    await recordSpendEvent({
      consumerId: row.consumerId,
      walletAddress: row.fromWallet,
      spendType: 'withdrawal',
      currency: 'USDC',
      amountUnits: row.grossUnits,
      amountLimitUnits: row.amountLimitUnits,
      counterparty: row.toAddress,
      txHash: withdrawTx,
    });

    return {
      success: true,
      txHash: withdrawTx,
      to: row.toAddress,
      amount: ethers.formatUnits(row.grossUnits, 6),
      net: ethers.formatUnits(row.netUnits, 6),
      fee: ethers.formatUnits(row.feeUnits, 6),
      currency: 'USDC',
    };
  } catch (e) {
    await db.query(
      `UPDATE consumer_withdrawals SET status = 'failed', error = $1 WHERE id = $2`,
      [(e as Error).message.slice(0, 500), params.withdrawalId],
    ).catch(() => {});
    throw e;
  }
}

export interface WithdrawalSummary {
  count: number;
  grossUsdc: number;
  feeUsdc: number;
  netUsdc: number;
  grossDisplay: string;
  feeDisplay: string;
  netDisplay: string;
}

function fmtUsdc(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Aggregates executed external withdrawals (assets that left the ecosystem). */
export async function getWithdrawalSummary(): Promise<WithdrawalSummary> {
  try {
    const r = await db.query<{ n: string; gross: string; fee: string; net: string }>(
      `SELECT COUNT(*)::text AS n,
              COALESCE(SUM(gross_units), 0)::text AS gross,
              COALESCE(SUM(fee_units), 0)::text AS fee,
              COALESCE(SUM(net_units), 0)::text AS net
         FROM consumer_withdrawals
        WHERE status = 'executed'`,
    );
    const row = r.rows[0];
    const grossUsdc = Number(row?.gross ?? 0) / 1e6;
    const feeUsdc = Number(row?.fee ?? 0) / 1e6;
    const netUsdc = Number(row?.net ?? 0) / 1e6;
    return {
      count: Number(row?.n ?? 0),
      grossUsdc,
      feeUsdc,
      netUsdc,
      grossDisplay: fmtUsdc(grossUsdc),
      feeDisplay: fmtUsdc(feeUsdc),
      netDisplay: fmtUsdc(netUsdc),
    };
  } catch {
    return {
      count: 0, grossUsdc: 0, feeUsdc: 0, netUsdc: 0,
      grossDisplay: '$0.00', feeDisplay: '$0.00', netDisplay: '$0.00',
    };
  }
}

export interface WithdrawalListItem {
  id: string;
  from_wallet: string;
  to_address: string;
  fromLabel: string;
  toLabel: string;
  grossDisplay: string;
  feeDisplay: string;
  netDisplay: string;
  fee_bps: number;
  status: string;
  withdraw_tx: string | null;
  recipient_name: string | null;
  recipient_country: string | null;
  created_at: string;
  executed_at: string | null;
  currency: string;
}

export async function listExecutedWithdrawals(limit = 100): Promise<WithdrawalListItem[]> {
  const r = await db.query<{
    id: string; from_wallet: string; to_address: string; gross_units: string; fee_units: string;
    net_units: string; fee_bps: number; status: string; withdraw_tx: string | null;
    recipient_name: string | null; recipient_country: string | null;
    created_at: Date; executed_at: Date | null; sender_tag: string | null; sender_display: string | null;
  }>(
    `SELECT w.id, w.from_wallet, w.to_address, w.gross_units::text, w.fee_units::text, w.net_units::text,
            w.fee_bps, w.status, w.withdraw_tx, w.recipient_name, w.recipient_country,
            w.created_at, w.executed_at,
            c.ens_subdomain AS sender_tag, c.display_name AS sender_display
       FROM consumer_withdrawals w
       LEFT JOIN consumers c ON c.consumer_id = w.consumer_id
      WHERE w.status = 'executed'
      ORDER BY COALESCE(w.executed_at, w.created_at) DESC
      LIMIT $1`,
    [limit],
  );
  return r.rows.map(row => {
    const gross = Number(row.gross_units) / 1e6;
    const fee = Number(row.fee_units) / 1e6;
    const net = Number(row.net_units) / 1e6;
    const fromLabel = row.sender_display || (row.sender_tag ? `@${row.sender_tag}` : row.from_wallet);
    const toShort = `${row.to_address.slice(0, 6)}…${row.to_address.slice(-4)}`;
    return {
      id: row.id,
      from_wallet: row.from_wallet,
      to_address: row.to_address,
      fromLabel,
      toLabel: row.recipient_name ? `${row.recipient_name} (${toShort})` : toShort,
      grossDisplay: gross.toFixed(2),
      feeDisplay: fee.toFixed(2),
      netDisplay: net.toFixed(2),
      fee_bps: row.fee_bps,
      status: row.status,
      withdraw_tx: row.withdraw_tx,
      recipient_name: row.recipient_name,
      recipient_country: row.recipient_country,
      created_at: row.created_at.toISOString?.() ?? String(row.created_at),
      executed_at: row.executed_at ? (row.executed_at.toISOString?.() ?? String(row.executed_at)) : null,
      currency: 'USDC',
    };
  });
}
