// src/auth.middleware.ts
// JWT bearer token guard. Attach to any route that requires a logged-in consumer.
// Sets req.consumer = { walletAddress, consumerId } on success.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from './config.js';
import type { ConsumerJwtPayload } from './types.js';

// Extend Express Request to carry the authenticated consumer
declare global {
  namespace Express {
    interface Request {
      consumer?: { walletAddress: string; consumerId: string };
      admin?:    { walletAddress: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as ConsumerJwtPayload;
    req.consumer = {
      walletAddress: payload.sub,
      consumerId:    payload.consumerId,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
