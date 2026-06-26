// scripts/prove-webauthn-sig.ts
// Proves the safeWebAuthn.ts INNER signature encoding against the LIVE deployed
// SafeWebAuthnSignerFactory on Sepolia — no biometric device required.
//
// We synthesise a WebAuthn assertion with a Node-generated P-256 key (a software
// stand-in for the authenticator), encode it exactly as a real device assertion
// would be encoded, and ask the factory's `isValidSignatureForSigner` view to
// validate it. A return of 0x1626ba7e means the encoding is correct end-to-end
// against the real verifier. The real device path differs only in WHERE the
// P-256 signature comes from (Secure Enclave vs Node) — the encoding is identical.
//
//   run:  cd server && npx tsx scripts/prove-webauthn-sig.ts

import crypto from 'crypto';
import { ethers } from 'ethers';
import config from '../src/config.js';
import { encodeWebAuthnSignature } from '../src/safeWebAuthn.js';

const FACTORY_ABI = [
  'function isValidSignatureForSigner(bytes32 message, bytes signature, uint256 x, uint256 y, uint176 verifiers) view returns (bytes4 magicValue)',
  'function getSigner(uint256 x, uint256 y, uint176 verifiers) view returns (address signer)',
];
const ERC1271_MAGIC = '0x1626ba7e';

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  // 1. Software authenticator: a P-256 keypair standing in for the Secure Enclave.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = BigInt('0x' + Buffer.from(jwk.x, 'base64url').toString('hex'));
  const y = BigInt('0x' + Buffer.from(jwk.y, 'base64url').toString('hex'));

  // 2. The message the Safe would ask the owner to validate (stand-in for a SafeTx hash).
  const message = crypto.createHash('sha256').update('prove-webauthn-sig').digest(); // 32 bytes

  // 3. Synthesise the assertion the same way a browser would.
  const clientDataJSON = Buffer.from(
    `{"type":"webauthn.get","challenge":"${b64url(message)}","origin":"${config.webauthn.origin}","crossOrigin":false}`,
    'utf8',
  );
  const rpIdHash = crypto.createHash('sha256').update(config.webauthn.rpId).digest(); // 32
  const flags = Buffer.from([0x05]);          // UP (0x01) | UV (0x04)
  const signCount = Buffer.from([0, 0, 0, 0]); // 4 bytes
  const authenticatorData = Buffer.concat([rpIdHash, flags, signCount]); // 37 bytes

  const clientHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signedData = Buffer.concat([authenticatorData, clientHash]);
  const derSignature = crypto.sign('sha256', signedData, privateKey); // DER ECDSA

  // Sanity: the assertion verifies locally before we trust the chain.
  const localOk = crypto.verify('sha256', signedData, publicKey, derSignature);
  console.log('local ECDSA verify:', localOk);

  // 4. Encode exactly as the relay path will, then ask the live factory to validate.
  const signature = encodeWebAuthnSignature({ authenticatorData, clientDataJSON, derSignature });
  const verifiers = config.safe.webAuthnVerifiers;

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const factory = new ethers.Contract(config.safe.webAuthnSignerFactory, FACTORY_ABI, provider);

  const signerAddr = await factory.getSigner(x, y, verifiers);
  console.log('counterfactual signer:', signerAddr);

  const magic: string = await factory.isValidSignatureForSigner(
    '0x' + message.toString('hex'), signature, x, y, verifiers,
  );
  console.log('isValidSignatureForSigner →', magic);
  console.log(magic === ERC1271_MAGIC ? '✅ PROVEN: encoding valid on live verifier' : '❌ FAILED');
  process.exit(magic === ERC1271_MAGIC ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
