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
import { ethers } from 'ethers';
import config from './config.js';
import db     from './db.js';
import type { ConsumerRow, ConsumerJwtPayload } from './types.js';

const router = express.Router();

interface NonceEntry { nonce: string; message: string; expiresAt: number }
const nonceStore = new Map<string, NonceEntry>();
const NONCE_TTL_MS = 5 * 60 * 1000;

function pruneNonces(): void {
  const now = Date.now();
  for (const [key, val] of nonceStore) {
    if (val.expiresAt < now) nonceStore.delete(key);
  }
}

// ── GET /api/auth/nonce ───────────────────────────────────────────────────────

router.get('/nonce', (req: Request, res: Response): void => {
  const wallet = (req.query.wallet as string | undefined)?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) {
    res.status(400).json({ error: 'Invalid wallet address' });
    return;
  }

  pruneNonces();

  const nonce     = ethers.hexlify(ethers.randomBytes(16));
  const message   = `Sign in to iMali\nWallet: ${wallet}\nNonce: ${nonce}`;
  const expiresAt = Date.now() + NONCE_TTL_MS;

  nonceStore.set(wallet, { nonce, message, expiresAt });
  res.json({ nonce, message, expiresAt });
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
    const stored = nonceStore.get(wallet);

    if (!stored || stored.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Nonce expired or not found. Request a new nonce.' });
      return;
    }

    const recovered = ethers.verifyMessage(stored.message, signature);
    if (recovered.toLowerCase() !== wallet) {
      res.status(401).json({ error: 'Signature verification failed' });
      return;
    }

    nonceStore.delete(wallet);

    const result = await db.query<ConsumerRow>(
      `SELECT consumer_id, kyc_level_id, country_code, ens_subdomain, is_active
       FROM consumers WHERE wallet_address = $1`,
      [wallet],
    );

    if (!result.rows.length) {
      res.status(404).json({ error: 'Wallet not registered. Complete registration first.' });
      return;
    }

    const consumer = result.rows[0];
    if (!consumer.is_active) {
      res.status(403).json({ error: 'Account is inactive.' });
      return;
    }

    const adminAddress = process.env.ADMIN_ADDRESS?.toLowerCase();
    const isAdmin      = Boolean(adminAddress && wallet === adminAddress);

    const payload: Omit<ConsumerJwtPayload, 'iat' | 'exp'> = {
      sub:         wallet,
      consumerId:  consumer.consumer_id,
      countryCode: consumer.country_code,
      kycLevel:    consumer.kyc_level_id,
      role:        isAdmin ? 'admin' : 'consumer',
    };

    const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] });

    res.json({
      token,
      consumer: {
        consumerId:    consumer.consumer_id,
        walletAddress: wallet,
        countryCode:   consumer.country_code,
        ensSubdomain:  consumer.ens_subdomain,
      },
    });
  } catch (err) {
    console.error('[POST /api/auth/login]', err);
    res.status(500).json({ error: 'Login failed', detail: (err as Error).message });
  }
});

export default router;
