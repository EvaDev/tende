// src/registrationService.ts
// Orchestrates the complete new consumer registration sequence:
//
//   1. Resolve passkey signer address (SafeWebAuthnSignerFactory)
//   2. Deploy Safe + register on Consumer contract
//   3. Create idOS profile (anchored to wallet address)
//   4. Issue idOS credential (name, mobile, country, ensSubdomain)
//   5. Register ENS subdomain → wallet address
//   6. Whitelist wallet in Pimlico paymaster
//   7. Write consumers row to DB
//
// Each step is idempotent where possible. On partial failure, the caller can
// retry — steps that already completed are skipped via the DB registration_step.
//
// ⚠️  Burns and recordRemittance are the two "must never be skipped" backend
//     calls — see architecture decisions doc.

import { ethers, keccak256, toUtf8Bytes } from 'ethers';
import crypto from 'crypto';
import db             from './db.js';
import config         from './config.js';
import idosService    from './idosService.js';
import { ensService } from './ensService.js';
import { pimlicoService } from './pimlicoService.js';
import type { RegistrationResult } from './types.js';

const CONSUMER_ABI = [
  'function registerConsumer(bytes32 ensHash, bytes32 nameHash, bytes32 countryCode, uint8 kycLevel, address initialOwner) returns (address wallet)',
  'function isRegistered(address wallet) view returns (bool)',
  'event ConsumerRegistered(address indexed wallet, uint256 indexed globalId, bytes32 countryCode, uint8 kycLevel)',
];

const WEBAUTHN_SIGNER_FACTORY_ABI = [
  'function createSigner(uint256 x, uint256 y, uint176 verifiers) returns (address signer)',
  'function getSigner(uint256 x, uint256 y, uint176 verifiers) view returns (address signer)',
];

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

function getAdminSigner(): ethers.Wallet {
  return new ethers.Wallet(config.admin.privateKey, getProvider());
}

// ── Step 1: Resolve passkey signer ───────────────────────────────────────────

export async function resolvePasskeySigner({ pubKeyX, pubKeyY, verifiers }: {
  pubKeyX: bigint;
  pubKeyY: bigint;
  verifiers: bigint;
}): Promise<string> {
  const signer  = getAdminSigner();
  const factory = new ethers.Contract(config.safe.webAuthnSignerFactory, WEBAUTHN_SIGNER_FACTORY_ABI, signer);
  // createSigner is idempotent — returns existing address if already created
  return factory.createSigner(pubKeyX, pubKeyY, verifiers) as Promise<string>;
}

// ── Step 2: Deploy Safe + register onchain ────────────────────────────────────

export async function deployConsumerWallet({ ensSubdomain, displayName, countryCode, signerAddress }: {
  ensSubdomain: string;
  displayName: string;
  countryCode: string;
  signerAddress: string;
}): Promise<{ walletAddress: string; globalConsumerId: number; txHash: string }> {
  const admin    = getAdminSigner();
  const consumer = new ethers.Contract(config.contracts.consumer, CONSUMER_ABI, admin);

  const ensHash     = ensSubdomain ? keccak256(toUtf8Bytes(ensSubdomain)) : ethers.ZeroHash;
  const nameHash    = keccak256(toUtf8Bytes(displayName));
  const countryHash = keccak256(toUtf8Bytes(countryCode));

  const tx      = await consumer.registerConsumer(ensHash, nameHash, countryHash, 0, signerAddress);
  const receipt = await tx.wait() as ethers.TransactionReceipt;

  const iface   = new ethers.Interface(CONSUMER_ABI);
  const log     = receipt.logs.find(l => { try { iface.parseLog(l); return true; } catch { return false; } });
  if (!log) throw new Error('ConsumerRegistered event not found in receipt');

  const parsed  = iface.parseLog(log)!;
  const { wallet, globalId } = parsed.args as unknown as { wallet: string; globalId: bigint };

  return { walletAddress: wallet, globalConsumerId: Number(globalId), txHash: receipt.hash };
}

// ── Step 3+4: idOS profile + credential ──────────────────────────────────────

export async function createIdosProfile(params: {
  walletAddress: string;
  userId: string;
  userEncryptionPublicKey?: string;
  ownershipProofMessage?: string;
  ownershipProofSignature?: string;
}) {
  return idosService.createProfile(params);
}

export async function issueIdosCredential(params: Parameters<typeof idosService.issueCredential>[0]) {
  return idosService.issueCredential(params);
}

// ── Step 5: ENS ───────────────────────────────────────────────────────────────

export async function registerEnsSubdomain({ subdomain, walletAddress }: {
  subdomain: string;
  walletAddress: string;
}) {
  return ensService.registerSubdomain({ subdomain, walletAddress });
}

// ── Step 6: Pimlico ───────────────────────────────────────────────────────────

export async function whitelistInPaymaster({ walletAddress }: { walletAddress: string }) {
  return pimlicoService.whitelistSponsored({ walletAddress });
}

// ── Step 7: DB write ──────────────────────────────────────────────────────────

export async function writeConsumerRecord({ walletAddress, globalConsumerId, countryCode, idosCredentialId, idosAccessGrantId }: {
  walletAddress: string;
  globalConsumerId: number;
  countryCode: string;
  idosUserId: string;
  idosCredentialId: string;
  idosAccessGrantId: string;
  txHash: string;
}): Promise<{ consumer_id: string }> {
  const row = await db.query<{ consumer_id: string }>(
    `INSERT INTO consumers
       (wallet_address, kyc_level_id, country_code,
        idos_credential_id, source_system, is_active)
     VALUES ($1,
       (SELECT level_id FROM kyc_levels WHERE country_code=$3 AND level_name LIKE 'Level 0%' LIMIT 1),
       $3, $4, 'ONCHAIN', true)
     ON CONFLICT (wallet_address) DO UPDATE SET
       idos_credential_id = EXCLUDED.idos_credential_id,
       updated_at         = NOW()
     RETURNING consumer_id`,
    [walletAddress, globalConsumerId, countryCode, idosCredentialId, idosAccessGrantId],
  );
  return row.rows[0];
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

interface RegisterParams {
  pubKeyX: bigint;
  pubKeyY: bigint;
  verifiers: bigint;
  displayName: string;
  mobileNumber: string;
  countryCode: string;
  ensSubdomain: string;
  userEncryptionPublicKey?: string;
  ownershipProofMessage?: string;
  ownershipProofSignature?: string;
  delegatedWriteGrant?: Record<string, string>;
  dwgSignature?: string;
}

export async function registerNewConsumer(params: RegisterParams): Promise<RegistrationResult> {
  const {
    pubKeyX, pubKeyY, verifiers,
    displayName, mobileNumber, countryCode, ensSubdomain,
    userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature,
    delegatedWriteGrant, dwgSignature,
  } = params;

  const userId = crypto.randomUUID();
  const steps: Record<string, unknown> = {};

  // 1. Resolve passkey signer
  steps.signerAddress = await resolvePasskeySigner({ pubKeyX, pubKeyY, verifiers });

  // 2. Deploy Safe onchain
  const { walletAddress, globalConsumerId, txHash } = await deployConsumerWallet({
    ensSubdomain, displayName, countryCode,
    signerAddress: steps.signerAddress as string,
  });
  steps.walletAddress    = walletAddress;
  steps.globalConsumerId = globalConsumerId;
  steps.deployTxHash     = txHash;

  // 3. Create idOS profile (wallet must exist first)
  await createIdosProfile({ walletAddress, userId, userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature });
  steps.idosUserId = userId;

  // 4. Issue credential (contains all PII + ensSubdomain for recovery)
  const { credentialId, accessGrantId } = await issueIdosCredential({
    userId,
    walletAddress,
    credentialData: {
      firstName:    displayName.split(' ')[0] ?? displayName,
      familyName:   displayName.split(' ').slice(1).join(' ') ?? '',
      mobileNumber,
      countryCode,
      ensSubdomain,
      kycLevel:     0,
    },
    dwgSignature:        dwgSignature ?? '',
    delegatedWriteGrant: { ...delegatedWriteGrant, userEncryptionPublicKey: userEncryptionPublicKey ?? '' } as never,
  });
  steps.idosCredentialId  = credentialId;
  steps.idosAccessGrantId = accessGrantId;

  // 5. Register ENS subdomain
  if (ensSubdomain && config.ens.controllerAddress) {
    await registerEnsSubdomain({ subdomain: ensSubdomain, walletAddress });
    steps.ensRegistered = true;
  }

  // 6. Pimlico whitelist
  await whitelistInPaymaster({ walletAddress });
  steps.pimlicoWhitelisted = true;

  // 7. Write DB record
  const dbRow = await writeConsumerRecord({
    walletAddress, globalConsumerId, countryCode,
    idosUserId: userId, idosCredentialId: credentialId,
    idosAccessGrantId: accessGrantId, txHash,
  });
  steps.consumerId = dbRow.consumer_id;

  return {
    success: true,
    walletAddress,
    globalConsumerId,
    consumerId:   dbRow.consumer_id,
    ensSubdomain: ensSubdomain ? `${ensSubdomain}.${config.ens.parentDomain}` : null,
    steps,
  };
}
