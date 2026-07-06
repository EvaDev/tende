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
import { recordGasFromReceipt } from './gasCostService.js';
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
  return new ethers.Wallet(config.backend.privateKey, getProvider());
}

// ── Step 1: Resolve passkey signer ───────────────────────────────────────────

export async function resolvePasskeySigner({ pubKeyX, pubKeyY, verifiers }: {
  pubKeyX: bigint;
  pubKeyY: bigint;
  verifiers: bigint;
}): Promise<string> {
  const signer  = getAdminSigner();
  const factory = new ethers.Contract(config.safe.webAuthnSignerFactory, WEBAUTHN_SIGNER_FACTORY_ABI, signer);
  // getSigner is a VIEW returning the deterministic signer address. createSigner is
  // a state-changing tx — it resolves to a TransactionResponse, NOT the address — so
  // we read the address from getSigner and only send createSigner to actually deploy
  // the signer contract when it has no code yet (it needs code to validate WebAuthn
  // signatures later). Returning the tx response was the cause of the registration
  // "unsupported addressable value" error.
  const signerAddress = await factory.getSigner(pubKeyX, pubKeyY, verifiers) as string;
  const code = await getProvider().getCode(signerAddress);
  if (code === '0x') {
    const tx = await factory.createSigner(pubKeyX, pubKeyY, verifiers);
    const receipt = await tx.wait() as ethers.TransactionReceipt;
    await recordGasFromReceipt(receipt, 'register_signer');
  }
  return signerAddress;
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
  await recordGasFromReceipt(receipt, 'register_deploy');

  // The receipt also carries the Safe ProxyCreation log; parseLog returns null
  // (not throws) for logs outside CONSUMER_ABI, so match on a non-null parse AND
  // the event name rather than "didn't throw".
  const iface = new ethers.Interface(CONSUMER_ABI);
  let parsed: ethers.LogDescription | null = null;
  for (const l of receipt.logs) {
    try {
      const p = iface.parseLog(l);
      if (p && p.name === 'ConsumerRegistered') { parsed = p; break; }
    } catch { /* not a Consumer event */ }
  }
  if (!parsed) throw new Error('ConsumerRegistered event not found in receipt');

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

export async function writeConsumerRecord({ walletAddress, countryCode, idosCredentialId, ensSubdomain, displayName, mobileNumber }: {
  walletAddress: string;
  globalConsumerId: number;
  countryCode: string;
  idosUserId: string;
  idosCredentialId: string;
  idosAccessGrantId: string;
  ensSubdomain: string;
  displayName: string;
  mobileNumber: string;
  txHash: string;
}): Promise<{ consumer_id: string }> {
  // Params must be sequential and all referenced or pg can't infer their types
  // ("could not determine data type of parameter $N"). We persist wallet, country
  // (also drives the KYC-level lookup), the idOS credential id (NULL when the
  // best-effort idOS step didn't complete), and the ENS subdomain (the @tag shown
  // in the app — previously never stored, so Account showed "@—").
  const row = await db.query<{ consumer_id: string }>(
    `INSERT INTO consumers
       (wallet_address, kyc_level_id, country_code, idos_credential_id, ens_subdomain,
        display_name, mobile_number, source_system, is_active)
     VALUES ($1,
       (SELECT level_id FROM kyc_levels WHERE country_code=$2 AND level_name LIKE 'Level 0%' LIMIT 1),
       $2, $3, $4, $5, $6, 'ONCHAIN', true)
     ON CONFLICT (wallet_address) DO UPDATE SET
       idos_credential_id = EXCLUDED.idos_credential_id,
       ens_subdomain      = EXCLUDED.ens_subdomain,
       display_name       = EXCLUDED.display_name,
       mobile_number      = EXCLUDED.mobile_number,
       updated_at         = NOW()
     RETURNING consumer_id`,
    [walletAddress, countryCode, idosCredentialId || null, ensSubdomain || null,
     displayName || null, mobileNumber || null],
  );
  return row.rows[0];
}

// ── Sign-up funnel tracking ───────────────────────────────────────────────────
// A row is written before any on-chain work and advanced as each step completes,
// so registrations that fail (or are abandoned) mid-flow are still counted and the
// failing step is recoverable. All writes are BEST-EFFORT — a tracking failure is
// logged but never aborts a real registration.

type RegStep = 'signer' | 'deploy' | 'idos' | 'ens' | 'pimlico' | 'db' | 'done';

async function attemptInsert(a: {
  attemptId: string; countryCode: string; ensSubdomain: string;
  displayName: string; mobileNumber: string;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO registration_attempts
         (attempt_id, status, country_code, ens_subdomain, display_name, mobile_number)
       VALUES ($1, 'started', $2, $3, $4, $5)
       ON CONFLICT (attempt_id) DO NOTHING`,
      [a.attemptId, a.countryCode || null, a.ensSubdomain || null, a.displayName || null, a.mobileNumber || null],
    );
  } catch (e) { console.error('[register] attempt insert failed (non-fatal):', (e as Error).message); }
}

async function attemptStep(attemptId: string, step: RegStep, extra?: {
  signerAddress?: string; walletAddress?: string; txHash?: string;
}): Promise<void> {
  try {
    await db.query(
      `UPDATE registration_attempts SET
         current_step   = $2,
         signer_address = COALESCE($3, signer_address),
         wallet_address = COALESCE($4, wallet_address),
         tx_hash        = COALESCE($5, tx_hash),
         updated_at     = NOW()
       WHERE attempt_id = $1`,
      [attemptId, step, extra?.signerAddress ?? null, extra?.walletAddress ?? null, extra?.txHash ?? null],
    );
  } catch (e) { console.error('[register] attempt step update failed (non-fatal):', (e as Error).message); }
}

async function attemptFinish(attemptId: string, status: 'completed' | 'failed', o: {
  failedStep?: RegStep; error?: string; steps?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.query(
      `UPDATE registration_attempts SET
         status       = $2,
         current_step = CASE WHEN $2 = 'completed' THEN 'done' ELSE current_step END,
         failed_step  = $3,
         error        = $4,
         steps        = $5,
         updated_at   = NOW()
       WHERE attempt_id = $1`,
      [attemptId, status, o.failedStep ?? null, o.error ?? null, o.steps ? JSON.stringify(o.steps) : null],
    );
  } catch (e) { console.error('[register] attempt finish failed (non-fatal):', (e as Error).message); }
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

  // Record the attempt before any on-chain work so a failure at any step below is
  // still counted (see registration_attempts / the sign-up funnel report). The
  // idOS userId doubles as the attempt id. `stage` tracks the critical step in
  // flight so the catch can record where a hard failure occurred.
  await attemptInsert({ attemptId: userId, countryCode, ensSubdomain, displayName, mobileNumber });
  let stage: RegStep = 'signer';

  try {
    // 1. Resolve passkey signer
    steps.signerAddress = await resolvePasskeySigner({ pubKeyX, pubKeyY, verifiers });
    await attemptStep(userId, 'signer', { signerAddress: steps.signerAddress as string });

    // 2. Deploy Safe onchain
    stage = 'deploy';
    const { walletAddress, globalConsumerId, txHash } = await deployConsumerWallet({
      ensSubdomain, displayName, countryCode,
      signerAddress: steps.signerAddress as string,
    });
    steps.walletAddress    = walletAddress;
    steps.globalConsumerId = globalConsumerId;
    steps.deployTxHash     = txHash;
    await attemptStep(userId, 'deploy', { walletAddress, txHash });

    // Steps 3–6 are external integrations (idOS, ENS, Pimlico). They are BEST-EFFORT:
    // a failure is logged and recorded in `steps`, but does not abort registration —
    // the wallet (signer + Safe) and the DB record are the critical path. This keeps
    // the pilot working while idOS issuer approval / mainnet ENS funding are pending;
    // failed steps can be retried out-of-band. Make them strict before production.
    // (current_step still advances past them; their per-step errors live in `steps`.)
    let credentialId = '';
    let accessGrantId = '';

    // 3. Create idOS profile (wallet must exist first)
    try {
      await createIdosProfile({ walletAddress, userId, userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature });
      steps.idosUserId = userId;

      // 4. Issue credential (contains all PII + ensSubdomain for recovery)
      const cred = await issueIdosCredential({
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
      credentialId  = cred.credentialId;
      accessGrantId = cred.accessGrantId;
      steps.idosCredentialId  = credentialId;
      steps.idosAccessGrantId = accessGrantId;
    } catch (e) {
      console.error('[register] idOS step failed (non-fatal):', (e as Error).message);
      steps.idosError = (e as Error).message;
    }
    await attemptStep(userId, 'idos');

    // 5. Register ENS subdomain
    if (ensSubdomain && config.ens.controllerAddress) {
      try {
        await registerEnsSubdomain({ subdomain: ensSubdomain, walletAddress });
        steps.ensRegistered = true;
      } catch (e) {
        console.error('[register] ENS step failed (non-fatal):', (e as Error).message);
        steps.ensError = (e as Error).message;
      }
    }
    await attemptStep(userId, 'ens');

    // 6. Pimlico whitelist
    try {
      await whitelistInPaymaster({ walletAddress });
      steps.pimlicoWhitelisted = true;
    } catch (e) {
      console.error('[register] Pimlico step failed (non-fatal):', (e as Error).message);
      steps.pimlicoError = (e as Error).message;
    }
    await attemptStep(userId, 'pimlico');

    // 7. Write DB record
    stage = 'db';
    const dbRow = await writeConsumerRecord({
      walletAddress, globalConsumerId, countryCode,
      idosUserId: userId, idosCredentialId: credentialId,
      idosAccessGrantId: accessGrantId, ensSubdomain,
      displayName, mobileNumber, txHash,
    });
    steps.consumerId = dbRow.consumer_id;
    await attemptStep(userId, 'db');

    await attemptFinish(userId, 'completed', { steps });

    return {
      success: true,
      walletAddress,
      globalConsumerId,
      consumerId:   dbRow.consumer_id,
      ensSubdomain: ensSubdomain ? `${ensSubdomain}.${config.ens.parentDomain}` : null,
      steps,
    };
  } catch (err) {
    // A hard failure in a critical step (signer / deploy / db). Best-effort steps
    // are caught above and never reach here. Record where it broke, then re-throw
    // so the route still surfaces the error to the caller.
    await attemptFinish(userId, 'failed', { failedStep: stage, error: (err as Error).message, steps });
    throw err;
  }
}
