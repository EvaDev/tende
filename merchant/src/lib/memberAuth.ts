// lib/memberAuth.ts
// Session management for merchant operators (see server/src/memberAuth.routes.ts).
// No wallet: claim (first login for an invited seat) and login both go through
// a passkey ceremony; the resulting JWT is stored like admin's auth_token.

import { api, setAuthToken } from './api';
import { createPasskey, getPasskeyAssertion } from './passkey';

export interface MemberSession {
  token: string;
  memberId: number;
  merchantId: string;
  role: 'org_admin' | 'store_manager' | 'cashier';
  displayName?: string;
}

const STORAGE_KEY = 'member_auth_token';

export async function claimSeat(memberId: number, email: string, displayName: string): Promise<MemberSession> {
  const opts = await api.post<{ challenge: string; rp: { id: string; name: string } }>(
    '/api/member-auth/claim-options', {},
  );
  const passkey = await createPasskey({
    challenge: opts.challenge, rpId: opts.rp.id, rpName: opts.rp.name,
    userId: btoa(String(memberId)).replace(/=+$/, ''), userName: email,
  });
  const result = await api.post<MemberSession>('/api/member-auth/claim', {
    memberId, email, displayName,
    credentialId: passkey.credentialId, publicKeyDer: passkey.publicKeyDer, clientDataJSON: passkey.clientDataJSON,
  });
  persist(result);
  return result;
}

export async function loginWithPasskey(): Promise<MemberSession> {
  const opts = await api.post<{ challenge: string; rpId: string }>('/api/member-auth/login-options', {});
  const assertion = await getPasskeyAssertion({ challenge: opts.challenge, rpId: opts.rpId });
  const result = await api.post<MemberSession>('/api/member-auth/login', assertion);
  persist(result);
  return result;
}

function persist(session: MemberSession): void {
  setAuthToken(session.token);
  localStorage.setItem(STORAGE_KEY, session.token);
}

function tokenExp(token: string): number | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function restoreToken(): string | null {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) return null;
  const exp = tokenExp(t);
  if (exp == null || exp * 1000 <= Date.now()) { logout(); return null; }
  setAuthToken(t);
  return t;
}

export function logout(): void {
  setAuthToken(null);
  localStorage.removeItem(STORAGE_KEY);
}
