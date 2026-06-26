// src/safeWebAuthn.ts
// Encodes a WebAuthn (passkey) assertion into the signature formats the deployed
// Safe stack expects, so the backend can relay a user-signed Safe transaction.
//
// Two layers:
//   1. INNER — the Safe `SafeWebAuthnSignerSingleton` signature:
//        abi.encode(bytes authenticatorData, string clientDataFields, uint256 r, uint256 s)
//      The on-chain verifier reconstructs clientDataJSON as
//        {"type":"webauthn.get","challenge":"<b64url(hash)>",<clientDataFields>}
//      so `clientDataFields` must be the exact trailing JSON the authenticator
//      produced (everything after the challenge field, before the closing brace).
//   2. OUTER — the Safe `checkNSignatures` contract-signature wrapper used in the
//      `signatures` argument of `execTransaction` for a single contract owner:
//        {65-byte slot: r=owner, s=offset(=65), v=0} ‖ {uint256 len} ‖ innerSig
//
// The passkey owner (SafeWebAuthnSignerSingleton) implements BOTH ERC-1271
// overloads, so this works on the deployed Safe 1.4.1 (legacy isValidSignature
// (bytes,bytes)→0x20c13b0b, which keccak-hashes the preimage) and on 1.5.0+
// (isValidSignature(bytes32,bytes)→0x1626ba7e). Either way the WebAuthn challenge
// the device signs must equal the SafeTx hash.

import { AbiCoder, concat, getBytes, hexlify, toBeHex, zeroPadValue } from 'ethers';

// secp256r1 (P-256) group order — used to normalise to low-S.
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const coder = AbiCoder.defaultAbiCoder();

/// Decode a DER-encoded ECDSA signature (SEQUENCE{ INTEGER r, INTEGER s }) into
/// (r, s). Browser/authenticator WebAuthn signatures are DER. Leading 0x00 pad
/// bytes on the INTEGERs are harmless — BigInt ignores them.
export function derToRS(der: Buffer): { r: bigint; s: bigint } {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error('Invalid DER: missing SEQUENCE');
  // Skip SEQUENCE length (short form — ECDSA P-256 sigs are < 128 bytes).
  if (der[o] & 0x80) throw new Error('Invalid DER: long-form length unexpected');
  o++;
  if (der[o++] !== 0x02) throw new Error('Invalid DER: missing INTEGER r');
  const rLen = der[o++];
  const r = BigInt('0x' + der.subarray(o, o + rLen).toString('hex'));
  o += rLen;
  if (der[o++] !== 0x02) throw new Error('Invalid DER: missing INTEGER s');
  const sLen = der[o++];
  const s = BigInt('0x' + der.subarray(o, o + sLen).toString('hex'));
  return { r, s };
}

/// Normalise S to the lower half of the curve order. Both (r,s) and (r,n−s) are
/// valid ECDSA signatures; the low-S form is the one every verifier accepts, so
/// we canonicalise before encoding (authenticators may emit high-S).
export function lowS(s: bigint): bigint {
  return s > P256_N / 2n ? P256_N - s : s;
}

/// Extract `clientDataFields` — the slice of clientDataJSON after the challenge
/// field and before the closing brace — exactly as the on-chain verifier expects
/// to re-concatenate it. The authenticator always emits `type` then `challenge`
/// first (WebAuthn §5.8.1 ordering), so the prefix is fixed; any trailing fields
/// (origin, crossOrigin, and optional extras) are captured verbatim.
export function extractClientDataFields(clientDataJSON: string): string {
  const m = clientDataJSON.match(
    /^\{"type":"webauthn\.get","challenge":"[A-Za-z0-9_-]+",(.*)\}$/,
  );
  if (!m) throw new Error('clientDataJSON not in expected WebAuthn.get shape');
  return m[1];
}

export interface RawAssertion {
  authenticatorData: Buffer; // raw bytes
  clientDataJSON: Buffer;    // raw bytes
  derSignature: Buffer;      // DER ECDSA signature
}

/// Build the INNER Safe WebAuthn signer signature from a raw assertion.
export function encodeWebAuthnSignature(a: RawAssertion): string {
  const clientDataFields = extractClientDataFields(a.clientDataJSON.toString('utf8'));
  const { r, s } = derToRS(a.derSignature);
  return coder.encode(
    ['bytes', 'string', 'uint256', 'uint256'],
    [hexlify(a.authenticatorData), clientDataFields, r, lowS(s)],
  );
}

/// Wrap an inner ERC-1271 signature as a Safe contract-signature for a single
/// contract owner, for the `signatures` argument of `execTransaction`.
export function encodeSafeContractSignature(owner: string, innerSig: string): string {
  const inner = getBytes(innerSig);
  const rSlot = zeroPadValue(owner, 32);         // r = owner address (left-padded)
  const sSlot = zeroPadValue(toBeHex(65), 32);   // s = offset to dynamic part (=65)
  const vByte = '0x00';                          // v = 0 → contract signature
  const lenSlot = zeroPadValue(toBeHex(inner.length), 32);
  return concat([rSlot, sSlot, vByte, lenSlot, inner]);
}
