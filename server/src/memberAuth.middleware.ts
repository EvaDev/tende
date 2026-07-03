// src/memberAuth.middleware.ts
// Guards routes for merchant *operators* (org/member model). Distinct from
// requireAuth (merchant's own wallet JWT) — a member logs in with a passkey
// scoped to one merchant org, no wallet involved.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from './config.js';
import type { MemberJwtPayload } from './types.js';

declare global {
  namespace Express {
    interface Request {
      member?: { memberId: number; merchantId: string; role: MemberJwtPayload['role'] };
    }
  }
}

export function requireMemberAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as MemberJwtPayload;
    if (payload.tokenRole !== 'merchant_member') {
      res.status(403).json({ error: 'Merchant operator access required' });
      return;
    }
    req.member = { memberId: payload.memberId, merchantId: payload.merchantId, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Head-office only (org_admin). Use for invites and settlement approval.
export function requireOrgAdmin(req: Request, res: Response, next: NextFunction): void {
  requireMemberAuth(req, res, () => {
    if (req.member?.role !== 'org_admin') {
      res.status(403).json({ error: 'Org admin (head office) access required' });
      return;
    }
    next();
  });
}
