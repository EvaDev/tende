// src/registration.routes.ts
// POST /api/register        — new consumer registration
// POST /api/register/check-ens — check if a subdomain is available
// POST /api/register/recover   — wallet recovery after lost device

import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import config                  from './config.js';
import { registerNewConsumer } from './registrationService.js';
import ensService              from './ensService.js';
import idosService             from './idosService.js';
import db                      from './db.js';

const router = express.Router();

// ── POST /api/register ────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      pubKeyX, pubKeyY, verifiers,
      displayName, mobileNumber, countryCode, ensSubdomain,
      userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature,
      delegatedWriteGrant, dwgSignature,
    } = req.body as Record<string, string>;

    const required = ['pubKeyX', 'pubKeyY', 'verifiers', 'displayName', 'mobileNumber', 'countryCode', 'ensSubdomain'];
    const missing  = required.filter(k => !req.body[k]);
    if (missing.length) {
      res.status(400).json({ error: 'Missing required fields', missing });
      return;
    }

    const result = await registerNewConsumer({
      pubKeyX:   BigInt(pubKeyX),
      pubKeyY:   BigInt(pubKeyY),
      verifiers: BigInt(verifiers),
      displayName, mobileNumber, countryCode, ensSubdomain,
      userEncryptionPublicKey, ownershipProofMessage, ownershipProofSignature,
      delegatedWriteGrant: typeof delegatedWriteGrant === 'string'
        ? JSON.parse(delegatedWriteGrant)
        : delegatedWriteGrant,
      dwgSignature,
    });

    res.status(201).json(result);
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
