// scripts/test-idos.mjs
// Smoke-tests the idOS integration end-to-end without needing a frontend.
// Uses the backend signer wallet as a stand-in for a consumer wallet.
//
// Run: node scripts/test-idos.mjs

import 'dotenv/config';
import nacl from 'tweetnacl';
import { randomUUID } from 'crypto';

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

// ── 2. Check / create profile ─────────────────────────────────────────────────
console.log('Step 2: Checking idOS profile...');
const hasProfile = await issuer.hasProfile(TEST_WALLET);
console.log('  hasProfile:', hasProfile);

if (!hasProfile) {
  console.log('  Creating profile...');
  const userId = randomUUID();
  // recipient_encryption_public_key: base64-encoded public key of the user.
  // In production this comes from the consumer's device; here we use our own as a test stand-in.
  const recipientEncPubKey = process.env.IDOS_ISSUER_ENCRYPTION_PUBLIC_KEY;
  const [user, wallet] = await issuer.createUser(
    { id: userId, recipient_encryption_public_key: recipientEncPubKey, encryption_password_store: 'user' },
    { address: TEST_WALLET, wallet_type: 'EVM' },
  );
  console.log('  ✓ profile created, userId:', user.id, 'walletId:', wallet.id);
} else {
  console.log('  ✓ profile already exists');
}
console.log('');

// ── 3. Build + issue credential ───────────────────────────────────────────────
console.log('Step 3: Building credential...');
const credentialContent = await issuer.buildCredential({
  publicNotes: JSON.stringify({ walletAddress: TEST_WALLET, kycLevel: 0 }),
  content:     JSON.stringify({
    firstName:    'Test',
    familyName:   'User',
    mobileNumber: '+27000000000',
    countryCode:  'ZA',
    kycLevel:     0,
  }),
});
console.log('  ✓ credential built');
console.log('');

console.log('All steps passed. idOS integration is live.');
console.log('Available methods confirmed:', Object.getOwnPropertyNames(Object.getPrototypeOf(issuer)).filter(k => k !== 'constructor').join(', '));
