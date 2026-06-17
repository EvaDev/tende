// scripts/test-idos.mjs
// Smoke-tests the idOS integration end-to-end without needing a frontend.
// Uses the backend signer wallet as a stand-in for a consumer wallet.
//
// Run: node scripts/test-idos.mjs

import 'dotenv/config';
import nacl from 'tweetnacl';

const TEST_WALLET = process.env.BACKEND_SIGNER_ADDRESS;
const TEST_USER_ID = `test-${Date.now()}`;

const nodeUrl   = process.env.IDOS_NODE_URL || 'https://nodes.idos.network';
const signingB64 = process.env.IDOS_ISSUER_SIGNING_SECRET_KEY;
const encB64     = process.env.IDOS_ISSUER_ENCRYPTION_SECRET_KEY;

if (!signingB64 || !encB64) {
  console.error('Missing IDOS_ISSUER_SIGNING_SECRET_KEY or IDOS_ISSUER_ENCRYPTION_SECRET_KEY in .env');
  process.exit(1);
}

const signingKeyPair      = nacl.sign.keyPair.fromSeed(Buffer.from(signingB64, 'base64'));
const encryptionSecretKey = Buffer.from(encB64, 'base64');

console.log('idOS smoke test');
console.log('  node:        ', nodeUrl);
console.log('  test wallet: ', TEST_WALLET);
console.log('  test userId: ', TEST_USER_ID);
console.log('');

// ── 1. Init issuer ────────────────────────────────────────────────────────────
console.log('Step 1: Initialising idOS issuer...');
const { idOSIssuer } = await import('@idos-network/issuer');
const issuer = await idOSIssuer.init({ nodeUrl, signingKeyPair, encryptionSecretKey });
console.log('  ✓ connected');
console.log('');

// ── 2. Create profile ─────────────────────────────────────────────────────────
console.log('Step 2: Creating idOS profile...');
try {
  await issuer.createProfile({
    userId:        TEST_USER_ID,
    walletAddress: TEST_WALLET,
    walletType:    'EVM',
  });
  console.log('  ✓ profile created for', TEST_WALLET);
} catch (err) {
  if (err.message?.includes('already exists')) {
    console.log('  ℹ profile already exists (ok for repeat runs)');
  } else {
    throw err;
  }
}
console.log('');

// ── 3. Issue credential ───────────────────────────────────────────────────────
console.log('Step 3: Issuing KYC credential...');
const credential = await issuer.createCredential({
  userId:            TEST_USER_ID,
  publicNotes:       JSON.stringify({ walletAddress: TEST_WALLET, kycLevel: 0 }),
  encryptedWith:     TEST_WALLET,
  credentialSubject: {
    firstName:    'Test',
    familyName:   'User',
    mobileNumber: '+27000000000',
    countryCode:  'ZA',
    kycLevel:     0,
  },
});
console.log('  ✓ credential id:', credential.id);
console.log('');

// ── 4. Verify we can read it back ─────────────────────────────────────────────
console.log('Step 4: Reading credential back...');
const fetched = await issuer.getCredential(credential.id);
console.log('  ✓ fetched credential, status:', fetched?.status ?? 'ok');
console.log('');
console.log('All steps passed. idOS integration is live.');
console.log('Credential id to save:', credential.id);
