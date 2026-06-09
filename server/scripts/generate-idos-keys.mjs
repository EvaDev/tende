// scripts/generate-idos-keys.mjs
// Run once to generate all three idOS issuer key pairs.
// Output goes to stdout — pipe to a file or paste into your secrets manager.
// Never commit the output.
//
// Usage: node scripts/generate-idos-keys.mjs

import nacl from 'tweetnacl';

const b64 = (buf) => Buffer.from(buf).toString('base64');

// ── 1. Encryption key (nacl BoxKeyPair) ───────────────────────────────────────
const encKp = nacl.box.keyPair();
console.log('# Encryption key pair (nacl BoxKeyPair)');
console.log('IDOS_ISSUER_ENCRYPTION_SECRET_KEY=' + b64(encKp.secretKey));
console.log('IDOS_ISSUER_ENCRYPTION_PUBLIC_KEY=' + b64(encKp.publicKey));
console.log('');

// ── 2. Signing key (nacl SignKeyPair) ─────────────────────────────────────────
const signKp = nacl.sign.keyPair();
console.log('# Signing key pair (nacl SignKeyPair)');
console.log('IDOS_ISSUER_SIGNING_SECRET_KEY=' + b64(signKp.secretKey));
console.log('IDOS_ISSUER_SIGNING_PUBLIC_KEY=' + b64(signKp.publicKey));
console.log('');

// ── 3. Multibase key (Ed25519 for W3C VCs) ────────────────────────────────────
// @digitalcredentials/ed25519-verification-key-2020 must be installed:
//   npm install @digitalcredentials/ed25519-verification-key-2020
try {
  const { Ed25519VerificationKey2020 } = await import('@digitalcredentials/ed25519-verification-key-2020');
  const multibaseKp = await Ed25519VerificationKey2020.generate();
  console.log('# Multibase Ed25519 key pair (for W3C VC signing)');
  console.log('IDOS_ISSUER_MULTIBASE_PRIVATE_KEY=' + multibaseKp.privateKeyMultibase);
  console.log('IDOS_ISSUER_MULTIBASE_PUBLIC_KEY='  + multibaseKp.publicKeyMultibase);
  console.log('');
  console.log('# Send the PUBLIC key + your issuer URI to engineering@idos.network');
  console.log('# IDOS_ISSUER_URI=https://api.imali.app/idos');
} catch {
  console.error('Install @digitalcredentials/ed25519-verification-key-2020 to generate multibase keys:');
  console.error('  npm install @digitalcredentials/ed25519-verification-key-2020');
}
