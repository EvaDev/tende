// src/registration.routes.ts
// POST /api/register        — new consumer registration
// POST /api/register/check-ens — check if a subdomain is available
// POST /api/register/recover   — wallet recovery after lost device

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import config                  from './config.js';
import { registerNewConsumer } from './registrationService.js';
import ensService              from './ensService.js';
import idosService             from './idosService.js';
import db                      from './db.js';
import { verifyRegistrationClientData, extractP256FromSpki, b64urlToBuf } from './webauthnService.js';

const router = express.Router();

// ── POST /api/register ────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      credentialId, publicKeyDer, clientDataJSON,
      displayName, mobileNumber, countryCode, ensSubdomain,
      userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature,
      delegatedWriteGrant, dwgSignature,
    } = req.body as Record<string, string>;

    const required = ['credentialId', 'publicKeyDer', 'clientDataJSON', 'displayName', 'mobileNumber', 'countryCode', 'ensSubdomain'];
    const missing  = required.filter(k => !req.body[k]);
    if (missing.length) {
      res.status(400).json({ error: 'Missing required fields', missing });
      return;
    }

    // 1. Validate the passkey creation ceremony (challenge + origin), then derive
    //    the P-256 coordinates from the credential's DER public key.
    verifyRegistrationClientData(clientDataJSON);
    const { x: pubKeyX, y: pubKeyY } = extractP256FromSpki(b64urlToBuf(publicKeyDer));
    const verifiers = config.safe.webAuthnVerifiers;

    const result = await registerNewConsumer({
      pubKeyX, pubKeyY, verifiers,
      displayName, mobileNumber, countryCode, ensSubdomain,
      userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature,
      delegatedWriteGrant: typeof delegatedWriteGrant === 'string'
        ? JSON.parse(delegatedWriteGrant)
        : delegatedWriteGrant,
      dwgSignature,
    });

    // 2. Persist the passkey credential so the user can log in on return.
    if (result.walletAddress) {
      await db.query(
        `INSERT INTO webauthn_credentials
           (credential_id, wallet_address, pub_key_x, pub_key_y, signer_address, rp_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (credential_id) DO UPDATE SET
           wallet_address = EXCLUDED.wallet_address,
           pub_key_x      = EXCLUDED.pub_key_x,
           pub_key_y      = EXCLUDED.pub_key_y,
           signer_address = EXCLUDED.signer_address`,
        [
          credentialId,
          result.walletAddress.toLowerCase(),
          pubKeyX.toString(),
          pubKeyY.toString(),
          (result.steps?.signerAddress as string) ?? null,
          config.webauthn.rpId,
        ],
      );
    }

    // 3. Issue a JWT so the consumer is immediately logged in after registration.
    const token = jwt.sign(
      {
        sub:         result.walletAddress,
        consumerId:  result.consumerId,
        countryCode: countryCode ?? 'ZA',
        kycLevel:    0,
        role:        'consumer',
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as import('jsonwebtoken').SignOptions['expiresIn'] },
    );

    res.status(201).json({ ...result, token });
  } catch (err) {
    console.error('[POST /api/register]', err);
    const msg = (err as Error).message ?? '';
    if (msg.includes('EnsAlreadyRegistered')) {
      res.status(409).json({ error: 'ENS subdomain already taken', code: 'ENS_TAKEN' });
      return;
    }
    if (msg.includes('PilotCapReached')) {
      res.status(503).json({ error: 'Pilot capacity reached', code: 'PILOT_CAP' });
      return;
    }
    res.status(500).json({ error: 'Registration failed', detail: msg });
  }
});

// ── POST /api/register/check-ens ─────────────────────────────────────────────

router.post('/check-ens', async (req: Request, res: Response): Promise<void> => {
  const { subdomain } = req.body as { subdomain?: string };
  if (!subdomain || !/^[a-z0-9-]{3,32}$/.test(subdomain)) {
    res.status(400).json({ error: 'Invalid subdomain. Use 3–32 lowercase alphanumeric characters.' });
    return;
  }

  try {
    const available = await ensService.isSubdomainAvailable(subdomain);
    res.json({ subdomain, fullName: ensService.fullName(subdomain), available });
  } catch (err) {
    console.warn('[check-ens] ENS check failed, assuming available:', (err as Error).message);
    res.json({ subdomain, fullName: ensService.fullName(subdomain), available: true });
  }
});

// ── POST /api/register/recover ────────────────────────────────────────────────

router.post('/recover', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      oldWalletAddress,
      pubKeyX, pubKeyY, verifiers,
      accessGrantId,
      userEncryptionPublicKey,
      ownershipProofMessage,
      ownershipProofSignature,
    } = req.body as Record<string, string>;

    if (!oldWalletAddress || !pubKeyX || !pubKeyY || !accessGrantId) {
      res.status(400).json({ error: 'Missing required recovery fields' });
      return;
    }

    // 1. Verify idOS credential to get ensSubdomain
    const credential = await idosService.verifyCredential({ accessGrantId });
    if (!credential.verified) {
      res.status(403).json({ error: 'idOS credential verification failed' });
      return;
    }

    const { ensSubdomain } = credential.credentialSubject;
    if (!ensSubdomain) {
      res.status(400).json({ error: 'No ENS subdomain found in credential. Cannot recover.' });
      return;
    }

    const ensHash = ethers.keccak256(ethers.toUtf8Bytes(ensSubdomain));

    // 2. Resolve new passkey signer
    const { resolvePasskeySigner } = await import('./registrationService.js');
    const newSignerAddress = await resolvePasskeySigner({
      pubKeyX:   BigInt(pubKeyX),
      pubKeyY:   BigInt(pubKeyY),
      verifiers: BigInt(verifiers),
    });

    // 3. Call recoverWallet on Consumer contract
    const CONSUMER_RECOVER_ABI = [
      'function recoverWallet(address oldWallet, bytes32 ensHash, address newOwner) returns (address newWallet)',
      'event WalletRecovered(address indexed oldWallet, address indexed newWallet, uint256 indexed globalConsumerId)',
    ];
    const admin    = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
    const contract = new ethers.Contract(config.contracts.consumer, CONSUMER_RECOVER_ABI, admin);
    const tx       = await contract.recoverWallet(oldWalletAddress, ensHash, newSignerAddress);
    const receipt  = await tx.wait() as ethers.TransactionReceipt;

    const iface  = new ethers.Interface(CONSUMER_RECOVER_ABI);
    const log    = receipt.logs.find(l => { try { iface.parseLog(l); return true; } catch { return false; } });
    const parsed = iface.parseLog(log!)!;
    const { newWallet } = parsed.args as unknown as { newWallet: string };

    // 4. Re-register ENS subdomain to new wallet
    await ensService.registerSubdomain({ subdomain: ensSubdomain, walletAddress: newWallet });

    // 5. Update idOS credential (public notes — private fields are immutable)
    await idosService.updateCredentialWallet({ credentialId: accessGrantId, newWalletAddress: newWallet });

    // 6. Update DB
    await db.query(
      `UPDATE consumers SET wallet_address=$1, updated_at=NOW() WHERE wallet_address=$2`,
      [newWallet, oldWalletAddress],
    );

    res.json({
      success:          true,
      oldWalletAddress,
      newWalletAddress: newWallet,
      ensSubdomain:     `${ensSubdomain}.${config.ens.parentDomain}`,
    });
  } catch (err) {
    console.error('[POST /api/register/recover]', err);
    res.status(500).json({ error: 'Recovery failed', detail: (err as Error).message });
  }
});

export default router;
