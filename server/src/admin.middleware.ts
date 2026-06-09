// src/admin.middleware.ts
// Guards admin-only routes.
// The JWT gains role:'admin' at login when the signing wallet matches ADMIN_ADDRESS.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from './config.js';
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
