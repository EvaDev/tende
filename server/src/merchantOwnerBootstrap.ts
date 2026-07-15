// src/merchantOwnerBootstrap.ts
// After a merchants row exists, ensure there is an org_admin seat the owner can
// claim with a passkey (merchant app). Used by self-service register and by the
// "already a merchant, open the merchant app for the first time" bootstrap path.

import type { PoolClient } from 'pg';
import db from './db.js';

export async function ensureOwnerOrgAdminSeat(
  merchantId: string,
  opts: { email?: string | null; displayName?: string | null } = {},
): Promise<{ memberId: number; created: boolean; status: string }> {
  // Prefer an existing unclaimed org_admin invite; else any active org_admin.
  const existing = await db.query<{ id: number; status: string }>(
    `SELECT id, status FROM merchant_members
      WHERE merchant_id = $1 AND role = 'org_admin'
      ORDER BY CASE status WHEN 'invited' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, id
      LIMIT 1`,
    [merchantId],
  );
  if (existing.rows[0]) {
    return {
      memberId: existing.rows[0].id,
      created: false,
      status: existing.rows[0].status,
    };
  }

  const email = opts.email?.trim().toLowerCase() || `owner+${merchantId.slice(0, 8)}@merchant.local`;
  const r = await db.query<{ id: number; status: string }>(
    `INSERT INTO merchant_members (merchant_id, email, display_name, role, status)
     VALUES ($1, $2, $3, 'org_admin', 'invited')
     RETURNING id, status`,
    [merchantId, email, opts.displayName ?? null],
  );
  return { memberId: r.rows[0].id, created: true, status: r.rows[0].status };
}

/** Same as ensureOwnerOrgAdminSeat but runnable inside an open transaction. */
export async function ensureOwnerOrgAdminSeatTx(
  client: PoolClient,
  merchantId: string,
  opts: { email?: string | null; displayName?: string | null } = {},
): Promise<{ memberId: number; created: boolean; status: string }> {
  const existing = await client.query<{ id: number; status: string }>(
    `SELECT id, status FROM merchant_members
      WHERE merchant_id = $1 AND role = 'org_admin'
      ORDER BY CASE status WHEN 'invited' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, id
      LIMIT 1`,
    [merchantId],
  );
  if (existing.rows[0]) {
    return {
      memberId: existing.rows[0].id,
      created: false,
      status: existing.rows[0].status,
    };
  }
  const email = opts.email?.trim().toLowerCase() || `owner+${merchantId.slice(0, 8)}@merchant.local`;
  const r = await client.query<{ id: number; status: string }>(
    `INSERT INTO merchant_members (merchant_id, email, display_name, role, status)
     VALUES ($1, $2, $3, 'org_admin', 'invited')
     RETURNING id, status`,
    [merchantId, email, opts.displayName ?? null],
  );
  return { memberId: r.rows[0].id, created: true, status: r.rows[0].status };
}
