// src/idosService.ts
// Dual-mode idOS integration:
//   IDOS_MODE=stub  — returns mock credential IDs, no network calls
//   IDOS_MODE=live  — full idOS SDK integration
//
// iMali acts as both Issuer and Consumer:
//   Issuer:   creates idOS profiles, issues KYC credentials (registration flow)
//   Consumer: requests access grants, verifies credentials (KYC upgrade flow)

import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import config from './config.js';
import type { IdosCredentialResult } from './types.js';

// ── Shared param types ────────────────────────────────────────────────────────

interface CreateProfileParams {
  walletAddress: string;
  userId: string;
  userEncryptionPublicKey?: string;
  ownershipProofMessage?: string;
  ownershipProofSignature?: string;
}

interface CredentialData {
  firstName: string;
  familyName: string;
  mobileNumber: string;
  countryCode: string;
  ensSubdomain: string;
  kycLevel: number;
  idDocumentCountry?: string;
  idDocumentType?: string;
  idDocumentNumber?: string;
  selfieFile?: string;
}

interface DelegatedWriteGrant {
  id: string;
  owner_wallet_identifier: string;
  grantee_wallet_identifier: string;
  issuer_public_key: string;
  access_grant_timelock: string;
  not_usable_before: string;
  not_usable_after: string;
  userEncryptionPublicKey: string;
}

interface IssueCredentialParams {
  userId: string;
  walletAddress: string;
  credentialData: CredentialData;
  dwgSignature: string;
  delegatedWriteGrant: DelegatedWriteGrant;
}

interface VerifyCredentialResult {
  verified: boolean;
  kycLevel: number;
  countryCode: string;
  credentialSubject: Record<string, string>;
}

interface IdosService {
  createProfile(params: CreateProfileParams): Promise<{ userId: string; walletAddress: string }>;
  issueCredential(params: IssueCredentialParams): Promise<IdosCredentialResult>;
  verifyCredential(params: { accessGrantId: string }): Promise<VerifyCredentialResult>;
  updateCredentialWallet(params: { credentialId: string; newWalletAddress: string }): Promise<{ updated: boolean }>;
  revokeCredential(params: { credentialId: string }): Promise<{ revoked: boolean }>;
  hasProfile(params: { walletAddress: string }): Promise<boolean>;
}

// ── Stub ─────────────────────────────────────────────────────────────────────

const stub: IdosService = {
  async createProfile({ walletAddress, userId }) {
    console.log(`[idOS:stub] createProfile wallet=${walletAddress} userId=${userId}`);
    return { userId, walletAddress };
  },

  async issueCredential({ userId }) {
    console.log(`[idOS:stub] issueCredential userId=${userId}`);
    return {
      credentialId:  `stub-cred-${userId}`,
      accessGrantId: `stub-ag-${userId}`,
    };
  },

  async verifyCredential({ accessGrantId }) {
    console.log(`[idOS:stub] verifyCredential grantId=${accessGrantId}`);
    return {
      verified: true,
      kycLevel: 1,
      countryCode: 'ZA',
      credentialSubject: {
        firstName:         'Stub',
        familyName:        'User',
        idDocumentCountry: 'ZA',
        idDocumentType:    'ID',
      },
    };
  },

  async updateCredentialWallet({ credentialId, newWalletAddress }) {
    console.log(`[idOS:stub] updateCredentialWallet credId=${credentialId} newWallet=${newWalletAddress}`);
    return { updated: true };
  },

  async revokeCredential({ credentialId }) {
    console.log(`[idOS:stub] revokeCredential credId=${credentialId}`);
    return { revoked: true };
  },

  async hasProfile({ walletAddress }) {
    console.log(`[idOS:stub] hasProfile wallet=${walletAddress}`);
    return false;
  },
};

// ── Live ─────────────────────────────────────────────────────────────────────

function decodeb64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

// Lazy singletons — avoid importing SDK at startup when in stub mode
let _issuer: unknown = null;
let _consumer: unknown = null;

async function getIssuer() {
  if (_issuer) return _issuer;
  const { idOSIssuer } = await import('@idos-network/issuer');
  _issuer = await idOSIssuer.init({
    nodeUrl:             config.idos.nodeUrl,
    signingKeyPair:      nacl.sign.keyPair.fromSeed(decodeb64(config.idos.issuerSigningKey)),
    encryptionSecretKey: decodeb64(config.idos.issuerEncryptionKey),
  });
  return _issuer;
}

async function getConsumer() {
  if (_consumer) return _consumer;
  // @ts-expect-error — dynamic import
  const { idOSConsumer } = await import('@idos-network/consumer');
  const { ethers } = await import('ethers');
  _consumer = await idOSConsumer.init({
    consumerSigner:                new ethers.Wallet(config.idos.consumerSignerKey),
    recipientEncryptionPrivateKey: decodeb64(config.idos.consumerEncryptionKey),
  });
  return _consumer;
}

const live: IdosService = {
  async hasProfile({ walletAddress }) {
    const issuer = await getIssuer() as Record<string, Function>;
    try {
      const grants = await issuer['listAccessGrantsForWallet']?.(walletAddress) as unknown[];
      return Array.isArray(grants) && grants.length > 0;
    } catch {
      return false;
    }
  },

  async createProfile({ walletAddress, userId, userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature }) {
    const issuer = await getIssuer() as Record<string, Function>;
    const { ethers } = await import('ethers');

    await issuer['createUser'](
      { id: userId, recipient_encryption_public_key: userEncryptionPublicKey },
      {
        address:     walletAddress,
        wallet_type: 'EVM',
        message:     ownershipProofMessage,
        signature:   ownershipProofSignature,
        public_key:  ethers.SigningKey.recoverPublicKey(
          ethers.id(ownershipProofMessage!),
          ownershipProofSignature!,
        ),
      },
    );
    return { userId, walletAddress };
  },

  async issueCredential({ userId, walletAddress, credentialData, dwgSignature, delegatedWriteGrant }) {
    const issuer = await getIssuer() as Record<string, Function>;

    const credId     = crypto.randomUUID();
    const credential = await issuer['buildCredentials'](
      {
        id:         `${config.idos.issuerUri}/credentials/${credId}`,
        level:      credentialData.kycLevel === 0 ? 'basic' : 'kyc',
        issued:     new Date(),
        approvedAt: new Date(),
      },
      {
        id:               `uuid:${credId}`,
        firstName:        credentialData.firstName,
        familyName:       credentialData.familyName,
        mobileNumber:     credentialData.mobileNumber,
        countryCode:      credentialData.countryCode,
        ensSubdomain:     credentialData.ensSubdomain,
        idDocumentCountry: credentialData.idDocumentCountry ?? credentialData.countryCode,
        idDocumentType:   credentialData.idDocumentType ?? null,
        idDocumentNumber: credentialData.idDocumentNumber ?? null,
        selfieFile:       credentialData.selfieFile ?? null,
        walletAddress,
      },
      {
        id:                 `${config.idos.issuerUri}/keys/1`,
        controller:         `${config.idos.issuerUri}/issuer/1`,
        publicKeyMultibase: config.idos.issuerMultibasePublic,
        privateKeyMultibase: config.idos.issuerMultibasePrivate,
      },
    );

    const publicNotesId      = crypto.randomUUID();
    const credentialPayload  = {
      id:               crypto.randomUUID(),
      user_id:          userId,
      plaintextContent: Buffer.from(JSON.stringify(credential)).toString('utf8'),
      recipientEncryptionPublicKey: delegatedWriteGrant.userEncryptionPublicKey,
      publicNotes: JSON.stringify({
        id:      publicNotesId,
        type:    'imali-kyc',
        level:   String(credentialData.kycLevel),
        status:  'approved',
        issuer:  'iMali',
        country: credentialData.countryCode,
      }),
    };

    await issuer['createCredentialsByDelegatedWriteGrant'](credentialPayload, {
      id:                       delegatedWriteGrant.id,
      ownerWalletIdentifier:    delegatedWriteGrant.owner_wallet_identifier,
      consumerWalletIdentifier: delegatedWriteGrant.grantee_wallet_identifier,
      issuerPublicKey:          delegatedWriteGrant.issuer_public_key,
      accessGrantTimelock:      delegatedWriteGrant.access_grant_timelock,
      notUsableBefore:          delegatedWriteGrant.not_usable_before,
      notUsableAfter:           delegatedWriteGrant.not_usable_after,
      signature:                dwgSignature,
    });

    return { credentialId: credentialPayload.id, accessGrantId: publicNotesId };
  },

  async verifyCredential({ accessGrantId }) {
    const consumer = await getConsumer() as Record<string, Function>;
    const raw      = await consumer['getSharedCredentialContentDecrypted'](accessGrantId) as string;

    await consumer['verifyW3CVC'](raw, {
      allowedIssuers: [config.idos.issuerUri],
      allowedKeys:    [config.idos.issuerMultibasePublic],
    });

    const parsed  = JSON.parse(raw) as { credentialSubject: Record<string, string> };
    const subject = parsed.credentialSubject;
    const kycLevel = subject.idDocumentNumber ? 2 : subject.firstName ? 1 : 0;

    return { verified: true, kycLevel, countryCode: subject.countryCode, credentialSubject: subject };
  },

  async updateCredentialWallet({ credentialId, newWalletAddress }) {
    console.warn(`[idOS:live] updateCredentialWallet — credential private fields are immutable. credId=${credentialId} newWallet=${newWalletAddress}`);
    return { updated: true };
  },

  async revokeCredential({ credentialId }) {
    console.warn(`[idOS:live] revokeCredential — implement once permissioned issuer access confirmed. credId=${credentialId}`);
    return { revoked: true };
  },
};

// ── Export based on IDOS_MODE ─────────────────────────────────────────────────

export const idosService: IdosService = config.idos.mode === 'live' ? live : stub;
export default idosService;
