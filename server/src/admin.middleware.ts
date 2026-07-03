// src/admin.middleware.ts
// Guards admin-only routes.
// The JWT gains role:'admin' at login when the signing wallet matches ADMIN_ADDRESS.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from './config.js';
import db from './db.js';
import type { ConsumerJwtPayload } from './types.js';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as ConsumerJwtPayload;
    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    req.admin = { walletAddress: payload.sub };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Allow a GET (read-only) endpoint through without auth when its page has been
// opted into public read-only viewing by an admin (app_config `app.public_pages`,
// a CSV of page keys). Otherwise fall back to requireAdmin. WRITE endpoints must
// NEVER use this — they always keep requireAdmin, which is the read-only guarantee.
export function allowPublicPage(pageKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const r = await db.query<{ value: string }>(
        `SELECT value FROM app_config WHERE key = 'app.public_pages'`);
      const list = (r.rows[0]?.value ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (list.includes(pageKey)) { next(); return; }
    } catch { /* fall through to admin auth */ }
    requireAdmin(req, res, next);
  };
}
