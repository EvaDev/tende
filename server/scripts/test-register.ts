// scripts/test-register.ts
// End-to-end registration test against the running backend (localhost:3001) with a
// synthetic passkey (Node P-256 stands in for the device authenticator). Proves the
// resolvePasskeySigner fix and that registration completes (Safe deployed + DB row)
// with idOS/ENS/Pimlico now best-effort. Deploys a real consumer Safe on Sepolia.
//   run: cd server && npx tsx scripts/test-register.ts

import crypto from 'crypto';

const BASE   = 'http://localhost:3001';
const ORIGIN = 'http://localhost:5173';
const b64url = (b: Buffer) => Buffer.from(b).toString('base64url');

async function main() {
  const opts = await (await fetch(`${BASE}/api/auth/passkey/register-options`)).json() as { challenge: string };
  console.log('register-options challenge:', opts.challenge.slice(0, 16) + '…');

  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyDer = b64url(publicKey.export({ format: 'der', type: 'spki' }) as Buffer);
  const clientDataJSON = b64url(Buffer.from(JSON.stringify({
    type: 'webauthn.create', challenge: opts.challenge, origin: ORIGIN, crossOrigin: false,
  }), 'utf8'));
  const credentialId = b64url(crypto.randomBytes(16));
  const tag = 'test' + crypto.randomBytes(3).toString('hex');

  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentialId, publicKeyDer, clientDataJSON,
      displayName: 'Test User', mobileNumber: '+27710000000', countryCode: 'ZA', ensSubdomain: tag,
    }),
  });
  const body = await res.json() as Record<string, unknown>;
  console.log('HTTP', res.status);
  console.log('walletAddress:', body.walletAddress);
  console.log('steps:', JSON.stringify(body.steps, null, 2));
  if (body.error) console.log('error:', body.error, body.detail ?? '');
  process.exit(res.status === 201 && body.walletAddress ? 0 : 1);
}
main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
