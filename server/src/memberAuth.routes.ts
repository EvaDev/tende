// src/memberAuth.routes.ts
// Auth for merchant *operators* (org/member model — see project_merchant_org_model
// memory). No wallet, no wallet-connect: identity is a passkey scoped to a
// merchant_members row. Reuses the same WebAuthn primitives as consumer auth
// (webauthnService.ts) — registration/login mechanics are identical, only what
// the credential is bound to (a member row, not a Safe wallet) differs.
//
//   POST /api/member-auth/claim-options          — challenge for an invited member's first passkey
//   POST /api/member-auth/claim                   — claim an invited seat: set email/passkey, activate
//   POST /api/member-auth/login-options            — challenge for navigator.credentials.get()
//   POST /api/member-auth/login                    — verify assertion, issue member JWT
//   GET  /api/member-auth/me                        — current member + org profile
//   POST /api/member-auth/invite   (org_admin only) — create a new invited member row

import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from './config.js';
import db from './db.js';
import { getAppDisplayName } from './appBrand.js';
import { newChallenge, extractP256FromSpki, verifyRegistrationClientData, verifyAssertion, b64urlToBuf } from './webauthnService.js';
import { requireMemberAuth, requireOrgAdmin } from './memberAuth.middleware.js';
import type { MemberJwtPayload } from './types.js';

const router = express.Router();

function signMemberJwt(payload: Omit<MemberJwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] });
}

interface MemberRow {
  id: number;
  merchant_id: string;
  email: string | null;
  display_name: string | null;
  role: 'org_admin' | 'store_manager' | 'cashier';
  status: 'invited' | 'active' | 'disabled';
  created_at?: string;
}

// ── POST /api/member-auth/invite ──────────────────────────────────────────────
// Head office adds a new operator seat. Returns memberId — communicate the
// claim link out-of-band (email/WhatsApp); there's no invite-token table yet
// (pilot scope: memberId is enough since only the invited email can claim it).
router.post('/invite', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, displayName, role, storeScope } = req.body as Record<string, string>;
    if (!email || !role) { res.status(400).json({ error: 'email and role required' }); return; }
    if (!['org_admin', 'store_manager', 'cashier'].includes(role)) {
      res.status(400).json({ error: 'role must be org_admin, store_manager, or cashier' }); return;
    }
    const scope = storeScope?.trim() || null;
    if (scope) {
      const storeOk = await db.query(
        `SELECT 1 FROM merchant_stores WHERE merchant_id = $1 AND store_code = $2 AND is_active = TRUE`,
        [req.member!.merchantId, scope],
      );
      if (!storeOk.rows.length) {
        res.status(400).json({ error: `Store code "${scope}" not found` });
        return;
      }
    }
    const r = await db.query<{ id: number }>(
      `INSERT INTO merchant_members (merchant_id, email, display_name, role, status, store_scope, invited_by)
       VALUES ($1, $2, $3, $4, 'invited', $5, $6)
       RETURNING id`,
      [req.member!.merchantId, email.toLowerCase(), displayName ?? null, role, scope, req.member!.memberId],
    );
    res.status(201).json({ memberId: r.rows[0].id });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const existing = await db.query<{ id: number; role: string; status: string }>(
        `SELECT id, role, status FROM merchant_members
          WHERE merchant_id = $1 AND email = $2`,
        [req.member!.merchantId, String((req.body as { email?: string }).email ?? '').toLowerCase()],
      );
      const row = existing.rows[0];
      if (row) {
        res.status(409).json({
          error: `This email already has a seat on your team (${row.role.replace('_', ' ')}, ${row.status}).`,
          memberId: row.id,
          status: row.status,
        });
        return;
      }
      res.status(409).json({ error: 'Already invited for this org' });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/member-auth/claim-options ───────────────────────────────────────
router.post('/claim-options', async (_req: Request, res: Response): Promise<void> => {
  const appName = await getAppDisplayName();
  res.json({ challenge: newChallenge(), rp: { id: config.webauthn.rpId, name: appName || config.webauthn.rpName } });
});

// ── POST /api/member-auth/claim ───────────────────────────────────────────────
// First login for a seeded/invited member: proves the passkey ceremony, binds
// email + a passkey to the row, flips status → active.
router.post('/claim', async (req: Request, res: Response): Promise<void> => {
  try {
    const { memberId, email, displayName, credentialId, publicKeyDer, clientDataJSON } =
      req.body as Record<string, string>;
    if (!memberId || !email || !credentialId || !publicKeyDer || !clientDataJSON) {
      res.status(400).json({ error: 'memberId, email, credentialId, publicKeyDer, clientDataJSON required' });
      return;
    }

    const mRes = await db.query<MemberRow>(`SELECT * FROM merchant_members WHERE id = $1`, [Number(memberId)]);
    const member = mRes.rows[0];
    if (!member) { res.status(404).json({ error: 'Invite not found' }); return; }
    if (member.status !== 'invited') { res.status(409).json({ error: 'Seat already claimed' }); return; }

    verifyRegistrationClientData(clientDataJSON);
    const { x, y } = extractP256FromSpki(b64urlToBuf(publicKeyDer));

    await db.transaction(async client => {
      await client.query(
        `UPDATE merchant_members SET email = $1, display_name = COALESCE($2, display_name), status = 'active' WHERE id = $3`,
        [email.toLowerCase(), displayName ?? null, member.id],
      );
      await client.query(
        `INSERT INTO merchant_member_credentials (member_id, credential_id, public_key_x, public_key_y)
         VALUES ($1, $2, $3, $4)`,
        [member.id, credentialId, x.toString(), y.toString()],
      );
    });

    const token = signMemberJwt({
      sub: String(member.id), memberId: member.id, merchantId: member.merchant_id,
      role: member.role, tokenRole: 'merchant_member',
    });
    res.status(201).json({ token, memberId: member.id, merchantId: member.merchant_id, role: member.role });
  } catch (err) {
    console.error('[POST /api/member-auth/claim]', err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── POST /api/member-auth/login-options ───────────────────────────────────────
router.post('/login-options', (_req: Request, res: Response): void => {
  res.json({ challenge: newChallenge(), rpId: config.webauthn.rpId });
});

// ── POST /api/member-auth/login ───────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { credentialId, authenticatorData, clientDataJSON, signature } = req.body as Record<string, string>;
    if (!credentialId || !authenticatorData || !clientDataJSON || !signature) {
      res.status(400).json({ error: 'Missing assertion fields' });
      return;
    }

    const credRes = await db.query<{ member_id: number; public_key_x: string; public_key_y: string; counter: number }>(
      `SELECT member_id, public_key_x, public_key_y, counter FROM merchant_member_credentials WHERE credential_id = $1`,
      [credentialId],
    );
    if (!credRes.rows.length) { res.status(404).json({ error: 'Passkey not recognised.' }); return; }
    const cred = credRes.rows[0];

    const { signCount } = verifyAssertion({
      authenticatorDataB64: authenticatorData,
      clientDataJSONb64:    clientDataJSON,
      signatureB64:         signature,
      pubKeyX: BigInt(cred.public_key_x),
      pubKeyY: BigInt(cred.public_key_y),
    });

    const prev = cred.counter;
    if (signCount !== 0 && prev !== 0 && signCount <= prev) {
      res.status(401).json({ error: 'Passkey counter regression — possible cloned authenticator' });
      return;
    }
    await db.query(`UPDATE merchant_member_credentials SET counter = $1 WHERE credential_id = $2`, [signCount, credentialId]);

    const mRes = await db.query<MemberRow>(`SELECT * FROM merchant_members WHERE id = $1`, [cred.member_id]);
    const member = mRes.rows[0];
    if (!member || member.status === 'disabled') { res.status(403).json({ error: 'Account is inactive.' }); return; }

    const token = signMemberJwt({
      sub: String(member.id), memberId: member.id, merchantId: member.merchant_id,
      role: member.role, tokenRole: 'merchant_member',
    });
    res.json({ token, memberId: member.id, merchantId: member.merchant_id, role: member.role, displayName: member.display_name });
  } catch (err) {
    console.error('[POST /api/member-auth/login]', err);
    res.status(401).json({ error: 'Passkey login failed', detail: (err as Error).message });
  }
});

// ── GET /api/member-auth/me ───────────────────────────────────────────────────
router.get('/me', requireMemberAuth, async (req: Request, res: Response): Promise<void> => {
  const r = await db.query<MemberRow & { merchant_name: string }>(
    `SELECT mm.*, m.name AS merchant_name FROM merchant_members mm
     JOIN merchants m ON m.merchant_id = mm.merchant_id WHERE mm.id = $1`,
    [req.member!.memberId],
  );
  if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  const m = r.rows[0];
  res.json({
    memberId: m.id, merchantId: m.merchant_id, merchantName: m.merchant_name,
    email: m.email, displayName: m.display_name, role: m.role, status: m.status,
  });
});

// ── GET /api/member-auth/members ──────────────────────────────────────────── (org_admin)
router.get('/members', requireOrgAdmin, async (req: Request, res: Response): Promise<void> => {
  const r = await db.query<MemberRow & { store_scope: string | null }>(
    `SELECT id, email, display_name, role, status, store_scope, created_at FROM merchant_members
     WHERE merchant_id = $1 ORDER BY created_at ASC`,
    [req.member!.merchantId],
  );
  res.json(r.rows);
});

export default router;
