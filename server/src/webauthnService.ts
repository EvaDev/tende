// src/webauthnService.ts
// WebAuthn (passkey) primitives for consumer auth — no external dependencies.
//
// Design (see project_webauthn_safe memory):
//   - Registration: client sends the credential's DER SubjectPublicKeyInfo
//     (from AuthenticatorAttestationResponse.getPublicKey()). We extract the
//     P-256 (x, y) from the trailing uncompressed point — no CBOR needed.
//   - Login: usernameless. Client sends a get() assertion; we verify the
//     ECDSA-P256 signature against the stored public key with Node crypto.
//   - Challenges live in an in-memory TTL store (single-instance; use Redis for HA).

import crypto from 'crypto';
import config from './config.js';

// ── base64url helpers ─────────────────────────────────────────────────────────
export function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
export function bufToB64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Challenge store (base64url string → expiry) ───────────────────────────────
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challenges = new Map<string, number>();

export function newChallenge(): string {
  const now = Date.now();
  for (const [c, exp] of challenges) if (exp < now) challenges.delete(c);
  const challenge = bufToB64url(crypto.randomBytes(32));
  challenges.set(challenge, now + CHALLENGE_TTL_MS);
  return challenge;
}
function consumeChallenge(challenge: string): boolean {
  const exp = challenges.get(challenge);
  if (exp === undefined || exp < Date.now()) { challenges.delete(challenge); return false; }
  challenges.delete(challenge);
  return true;
}

// ── Extract P-256 (x, y) from a DER SubjectPublicKeyInfo ──────────────────────
// For an EC P-256 key the SPKI ends with the uncompressed point: 0x04 ‖ X(32) ‖ Y(32).
export function extractP256FromSpki(der: Buffer): { x: bigint; y: bigint } {
  const marker = der.lastIndexOf(0x04, der.length - 65);
  // The uncompressed point is the final 65 bytes; validate the 0x04 prefix sits there.
  const point = der.subarray(der.length - 65);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error('Unsupported public key format (expected uncompressed P-256 point)');
  }
  void marker;
  const x = BigInt('0x' + point.subarray(1, 33).toString('hex'));
  const y = BigInt('0x' + point.subarray(33, 65).toString('hex'));
  return { x, y };
}

// ── Verify clientDataJSON (shared by register + login) ────────────────────────
function verifyClientData(clientDataJSON: Buffer, expectedType: 'webauthn.create' | 'webauthn.get'): void {
  let data: { type?: string; challenge?: string; origin?: string };
  try { data = JSON.parse(clientDataJSON.toString('utf8')); }
  catch { throw new Error('Invalid clientDataJSON'); }

  if (data.type !== expectedType) throw new Error(`Unexpected clientData type: ${data.type}`);
  if (data.origin !== config.webauthn.origin) throw new Error(`Origin mismatch: ${data.origin}`);
  if (!data.challenge || !consumeChallenge(data.challenge)) {
    throw new Error('Challenge invalid, expired, or replayed');
  }
}

// Registration: only the challenge/origin need checking (the public key is bound
// to a fresh wallet, so attestation forgery is not a cross-account threat).
export function verifyRegistrationClientData(clientDataJSONb64: string): void {
  verifyClientData(b64urlToBuf(clientDataJSONb64), 'webauthn.create');
}

// ── Build a Node KeyObject from stored (x, y) ─────────────────────────────────
function publicKeyFromXY(x: bigint, y: bigint): crypto.KeyObject {
  const toB64url = (n: bigint) => bufToB64url(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
  return crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: toB64url(x), y: toB64url(y) },
    format: 'jwk',
  });
}

// ── Verify a login assertion ──────────────────────────────────────────────────
export function verifyAssertion(params: {
  authenticatorDataB64: string;
  clientDataJSONb64: string;
  signatureB64: string;
  pubKeyX: bigint;
  pubKeyY: bigint;
}): { signCount: number } {
  const authData    = b64urlToBuf(params.authenticatorDataB64);
  const clientData  = b64urlToBuf(params.clientDataJSONb64);
  const signature   = b64urlToBuf(params.signatureB64);

  verifyClientData(clientData, 'webauthn.get');

  // rpIdHash = first 32 bytes of authData must equal sha256(rpId)
  const rpIdHash = authData.subarray(0, 32);
  const expected = crypto.createHash('sha256').update(config.webauthn.rpId).digest();
  if (!rpIdHash.equals(expected)) throw new Error('rpIdHash mismatch');

  // flags byte: bit0 = user present
  const flags = authData[32];
  if ((flags & 0x01) === 0) throw new Error('User presence flag not set');

  // Signed data = authenticatorData ‖ sha256(clientDataJSON); ECDSA over its sha256.
  const clientHash = crypto.createHash('sha256').update(clientData).digest();
  const signedData = Buffer.concat([authData, clientHash]);

  const key = publicKeyFromXY(params.pubKeyX, params.pubKeyY);
  const ok  = crypto.verify('sha256', signedData, key, signature); // DER signature (default)
  if (!ok) throw new Error('Assertion signature verification failed');

  const signCount = authData.readUInt32BE(33);
  return { signCount };
}
