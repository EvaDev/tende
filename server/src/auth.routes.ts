// src/auth.routes.ts
// Wallet-based authentication — no passwords, no seed phrases.
//
// Flow:
//   1. GET  /api/auth/nonce?wallet=0x…  — server issues a one-time nonce
//   2. POST /api/auth/login             — consumer submits signed nonce, gets JWT
//
// The nonce is stored in-memory (Map) with a 5-minute TTL.
// For multi-instance deployments, replace with a Redis-backed store.

import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from './config.js';
import db     from './db.js';
import { newChallenge, bufToB64url, verifyAssertion } from './webauthnService.js';
import { issueNonce, verifyAndConsume } from './authNonce.js';
import crypto from 'crypto';
import type { ConsumerRow, ConsumerJwtPayload } from './types.js';

const router = express.Router();

function signConsumerJwt(payload: Omit<ConsumerJwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] });
}

// ── GET /api/auth/role ────────────────────────────────────────────────────────
// Read-only role probe (no signature). Lets the admin UI decide whether a freshly
// connected wallet is a known admin/merchant or a new wallet (→ merchant signup).
router.get('/role', async (req: Request, res: Response): Promise<void> => {
  const wallet = (req.query.wallet as string | undefined)?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) { res.status(400).json({ error: 'Invalid wallet address' }); return; }
  const [a, m] = await Promise.all([
    db.query(`SELECT 1 FROM admins    WHERE wallet_address = $1 AND is_active`, [wallet]),
    db.query(`SELECT 1 FROM merchants WHERE LOWER(wallet_address) = $1 AND is_active`, [wallet]),
  ]);
  res.json({ role: a.rows.length ? 'admin' : m.rows.length ? 'merchant' : 'none' });
});

// ── GET /api/auth/nonce ───────────────────────────────────────────────────────

router.get('/nonce', (req: Request, res: Response): void => {
  const wallet = (req.query.wallet as string | undefined)?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) {
    res.status(400).json({ error: 'Invalid wallet address' });
    return;
  }
  res.json(issueNonce(wallet));
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress, signature } = req.body as { walletAddress?: string; signature?: string };
    if (!walletAddress || !signature) {
      res.status(400).json({ error: 'walletAddress and signature required' });
      return;
    }

    const wallet = walletAddress.toLowerCase();

    if (!verifyAndConsume(wallet, signature)) {
      res.status(401).json({ error: 'Signature verification failed or nonce expired. Request a new nonce.' });
      return;
    }

    // Determine role by checking DB tables in priority order
    const [adminRes, merchantRes, consumerRes] = await Promise.all([
      db.query<{ is_active: boolean }>(
        `SELECT is_active FROM admins WHERE wallet_address = $1`, [wallet]),
      db.query<{ merchant_id: string; is_active: boolean }>(
        `SELECT merchant_id, is_active FROM merchants WHERE LOWER(wallet_address) = $1`, [wallet]),
      db.query<ConsumerRow>(
        `SELECT consumer_id, kyc_level_id, country_code, ens_subdomain, is_active
         FROM consumers WHERE LOWER(wallet_address) = $1`, [wallet]),
    ]);

    const admin    = adminRes.rows[0];
    const merchant = merchantRes.rows[0];
    const consumer = consumerRes.rows[0];

    if (!admin && !merchant && !consumer) {
      res.status(404).json({ error: 'Wallet not registered.' });
      return;
    }

    if (admin && !admin.is_active) { res.status(403).json({ error: 'Admin account is inactive.' }); return; }
    if (merchant && !merchant.is_active) { res.status(403).json({ error: 'Merchant account is inactive.' }); return; }
    if (consumer && !consumer.is_active && !admin) { res.status(403).json({ error: 'Account is inactive.' }); return; }

    const role = admin ? 'admin' : merchant ? 'merchant' : 'consumer';

    const payload: Omit<ConsumerJwtPayload, 'iat' | 'exp'> = {
      sub:         wallet,
      consumerId:  consumer?.consumer_id ?? merchant?.merchant_id ?? '',
      countryCode: consumer?.country_code ?? '',
      kycLevel:    consumer?.kyc_level_id ?? 0,
      role,
    };

    const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] });

    res.json({
      token,
      role,
      consumer: consumer ? {
        consumerId:    consumer.consumer_id,
        walletAddress: wallet,
        countryCode:   consumer.country_code,
        ensSubdomain:  consumer.ens_subdomain,
      } : null,
    });
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    res.status(500).json({ error: 'Login failed', detail: (err as Error).message });
  }
});

// ── Passkey (WebAuthn) auth ───────────────────────────────────────────────────
// Registration consumes its options via POST /api/register; here we serve the
// challenge for the create() ceremony and the full login (get()) ceremony.

// GET /api/auth/passkey/register-options — challenge + RP info for navigator.credentials.create()
router.get('/passkey/register-options', (_req: Request, res: Response): void => {
  res.json({
    challenge: newChallenge(),
    rp:        { id: config.webauthn.rpId, name: config.webauthn.rpName },
    // Fresh random user handle — the Safe wallet doesn't exist until registration completes.
    userId:    bufToB64url(crypto.randomBytes(16)),
  });
});

// POST /api/auth/passkey/login-options — challenge for navigator.credentials.get()
router.post('/passkey/login-options', (_req: Request, res: Response): void => {
  res.json({ challenge: newChallenge(), rpId: config.webauthn.rpId });
});

// POST /api/auth/passkey/login — verify a usernameless assertion, issue JWT
router.post('/passkey/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { credentialId, authenticatorData, clientDataJSON, signature } = req.body as Record<string, string>;
    if (!credentialId || !authenticatorData || !clientDataJSON || !signature) {
      res.status(400).json({ error: 'Missing assertion fields' });
      return;
    }

    const credRes = await db.query<{ wallet_address: string; pub_key_x: string; pub_key_y: string; sign_count: string }>(
      `SELECT wallet_address, pub_key_x, pub_key_y, sign_count FROM webauthn_credentials WHERE credential_id = $1`,
      [credentialId],
    );
    if (!credRes.rows.length) {
      res.status(404).json({ error: 'Passkey not recognised. Register first.' });
      return;
    }
    const cred = credRes.rows[0];

    const { signCount } = verifyAssertion({
      authenticatorDataB64: authenticatorData,
      clientDataJSONb64:    clientDataJSON,
      signatureB64:         signature,
      pubKeyX:              BigInt(cred.pub_key_x),
      pubKeyY:              BigInt(cred.pub_key_y),
    });

    // Anti-clone: a non-zero counter must strictly increase.
    const prev = Number(cred.sign_count);
    if (signCount !== 0 && prev !== 0 && signCount <= prev) {
      res.status(401).json({ error: 'Passkey counter regression — possible cloned authenticator' });
      return;
    }

    await db.query(
      `UPDATE webauthn_credentials SET sign_count = $1, last_used_at = NOW() WHERE credential_id = $2`,
      [signCount, credentialId],
    );

    const wallet = cred.wallet_address.toLowerCase();
    const cRes = await db.query<ConsumerRow>(
      `SELECT consumer_id, kyc_level_id, country_code, ens_subdomain, is_active
       FROM consumers WHERE LOWER(wallet_address) = $1`,
      [wallet],
    );
    const consumer = cRes.rows[0];
    if (consumer && !consumer.is_active) { res.status(403).json({ error: 'Account is inactive.' }); return; }

    const token = signConsumerJwt({
      sub:         wallet,
      consumerId:  consumer?.consumer_id ?? '',
      countryCode: consumer?.country_code ?? '',
      kycLevel:    consumer?.kyc_level_id ?? 0,
      role:        'consumer',
    });

    res.json({
      token,
      consumer: consumer ? {
        consumerId:    consumer.consumer_id,
        walletAddress: wallet,
        countryCode:   consumer.country_code,
        ensSubdomain:  consumer.ens_subdomain,
      } : null,
    });
  } catch (err) {
    console.error('[POST /api/auth/passkey/login]', err);
    res.status(401).json({ error: 'Passkey login failed', detail: (err as Error).message });
  }
});

export default router;
