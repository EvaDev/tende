// scripts/test-member-auth.ts
// End-to-end smoke test of the new merchant-org member auth against the running
// backend (localhost:3001): claim Pep's seeded org_admin seat with a synthetic
// passkey, log in with it, invite a cashier, claim the cashier seat too.
//   run: cd server && npx tsx scripts/test-member-auth.ts

import crypto from 'crypto';
import config from '../src/config.js';

const BASE = 'http://localhost:3001';
const ORIGIN = config.webauthn.origin;
const b64url = (b: Buffer) => Buffer.from(b).toString('base64url');

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { publicKey, privateKey };
}

async function claim(memberId: number, email: string) {
  const opts = await (await fetch(`${BASE}/api/member-auth/claim-options`, { method: 'POST' })).json() as { challenge: string };
  const { publicKey, privateKey } = makeKeypair();
  const publicKeyDer = b64url(publicKey.export({ format: 'der', type: 'spki' }) as Buffer);
  const clientDataJSON = b64url(Buffer.from(JSON.stringify({
    type: 'webauthn.create', challenge: opts.challenge, origin: ORIGIN, crossOrigin: false,
  }), 'utf8'));
  const credentialId = b64url(crypto.randomBytes(16));

  const res = await fetch(`${BASE}/api/member-auth/claim`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId, email, displayName: 'Test Head Office', credentialId, publicKeyDer, clientDataJSON }),
  });
  const body = await res.json() as Record<string, unknown>;
  console.log('claim →', res.status, body);
  return { ...body, credentialId, privateKey } as { token: string; credentialId: string; privateKey: crypto.KeyObject };
}

async function login(credentialId: string, privateKey: crypto.KeyObject) {
  const opts = await (await fetch(`${BASE}/api/member-auth/login-options`, { method: 'POST' })).json() as { challenge: string; rpId: string };
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.get', challenge: opts.challenge, origin: ORIGIN, crossOrigin: false,
  }), 'utf8');
  const rpIdHash = crypto.createHash('sha256').update(opts.rpId).digest();
  const flags = Buffer.from([0x05]);
  const signCount = Buffer.from([0, 0, 0, 1]);
  const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]);
  const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signedData = Buffer.concat([authenticatorData, clientHash]);
  const signature = crypto.sign('sha256', signedData, privateKey);

  const res = await fetch(`${BASE}/api/member-auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentialId, authenticatorData: b64url(authenticatorData),
      clientDataJSON: b64url(clientDataJSON), signature: b64url(signature),
    }),
  });
  const body = await res.json() as Record<string, unknown>;
  console.log('login →', res.status, body);
  return body as { token: string };
}

async function main() {
  // 1. Claim Pep's seeded org_admin seat (id=1 per db/023 seed).
  const claimed = await claim(3, 'headoffice@pep.test');
  if (!claimed.token) { console.error('claim failed'); process.exit(1); }

  // 2. Log back in with the same passkey.
  const loggedIn = await login(claimed.credentialId, claimed.privateKey);
  if (!loggedIn.token) { console.error('login failed'); process.exit(1); }

  // 3. Head office invites a cashier.
  const inviteRes = await fetch(`${BASE}/api/member-auth/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loggedIn.token}` },
    body: JSON.stringify({ email: 'cashier@pep.test', displayName: 'Till 1', role: 'cashier' }),
  });
  const inviteBody = await inviteRes.json() as { memberId: number };
  console.log('invite →', inviteRes.status, inviteBody);
  if (inviteRes.status !== 201) process.exit(1);

  // 4. Cashier claims their seat.
  const cashier = await claim(inviteBody.memberId, 'cashier@pep.test');
  if (!cashier.token) { console.error('cashier claim failed'); process.exit(1); }

  // 5. /me for both.
  const meHO = await (await fetch(`${BASE}/api/member-auth/me`, { headers: { Authorization: `Bearer ${loggedIn.token}` } })).json();
  const meCashier = await (await fetch(`${BASE}/api/member-auth/me`, { headers: { Authorization: `Bearer ${cashier.token}` } })).json();
  console.log('me (head office) →', meHO);
  console.log('me (cashier)     →', meCashier);

  // 6. Cashier tries to invite (should 403 — not org_admin).
  const forbidden = await fetch(`${BASE}/api/member-auth/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashier.token}` },
    body: JSON.stringify({ email: 'x@pep.test', role: 'cashier' }),
  });
  console.log('cashier invite attempt →', forbidden.status, '(expect 403)');

  // 7. Settlement: set a threshold, request below it (auto-exec attempt — expect
  //    a graceful 502 since the merchant's currency ZAR has no stablecoins row),
  //    then request above it (expect pending) and approve with head office.
  const cfgRes = await fetch(`${BASE}/api/settlement/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loggedIn.token}` },
    body: JSON.stringify({ thresholdAmount: 100, thresholdCurrency: 'ZAR', requireApproval: true }),
  });
  console.log('settlement config →', cfgRes.status, await cfgRes.json());

  const smallReq = await fetch(`${BASE}/api/settlement/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashier.token}` },
    body: JSON.stringify({ amount: '10', currency: 'ZAR', destination: '0x000000000000000000000000000000000000dEaD' }),
  });
  console.log('small request (auto-exec attempt) →', smallReq.status, await smallReq.json());

  const bigReq = await fetch(`${BASE}/api/settlement/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cashier.token}` },
    body: JSON.stringify({ amount: '500', currency: 'ZAR', destination: '0x000000000000000000000000000000000000dEaD' }),
  });
  const bigBody = await bigReq.json() as { id: number; status: string };
  console.log('big request (should be pending) →', bigReq.status, bigBody);

  const selfApprove = await fetch(`${BASE}/api/settlement/requests/${bigBody.id}/approve`, {
    method: 'POST', headers: { Authorization: `Bearer ${cashier.token}` },
  });
  console.log('cashier tries to approve →', selfApprove.status, '(expect 403, not org_admin)');

  const hoApprove = await fetch(`${BASE}/api/settlement/requests/${bigBody.id}/approve`, {
    method: 'POST', headers: { Authorization: `Bearer ${loggedIn.token}` },
  });
  console.log('head office approves →', hoApprove.status, await hoApprove.json());

  process.exit(0);
}
main().catch(e => { console.error('ERROR:', e); process.exit(1); });
