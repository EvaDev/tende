// lib/passkey.ts
// WebAuthn passkey ceremonies for the consumer app. The passkey is the signer
// for the user's Safe smart wallet — there is no MetaMask, seed phrase, or gas.
//
// Registration: navigator.credentials.create() with ES256 (P-256), resident key.
//   We send the credential's DER public key to the server, which derives the
//   Safe signer. Login: usernameless navigator.credentials.get() assertion.

function b64urlToBuf(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined'
    && !!navigator.credentials;
}

export interface PasskeyRegistration {
  credentialId: string;
  publicKeyDer: string;
  clientDataJSON: string;
}

export async function createPasskey(opts: {
  challenge: string; rpId: string; rpName: string; userId: string; userName: string;
}): Promise<PasskeyRegistration> {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: b64urlToBuf(opts.challenge),
      rp: { id: opts.rpId, name: opts.rpName },
      user: { id: b64urlToBuf(opts.userId), name: opts.userName, displayName: opts.userName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 / P-256 (required for Safe)
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null;

  if (!cred) throw new Error('Passkey creation was cancelled.');
  const resp = cred.response as AuthenticatorAttestationResponse;

  if (typeof resp.getPublicKeyAlgorithm === 'function' && resp.getPublicKeyAlgorithm() !== -7) {
    throw new Error('This passkey is not P-256 (ES256) and cannot back a Safe wallet.');
  }
  const der = typeof resp.getPublicKey === 'function' ? resp.getPublicKey() : null;
  if (!der) {
    throw new Error('Your browser did not expose the passkey public key. Use a recent browser with a platform authenticator (Face ID / Touch ID / Windows Hello).');
  }

  return {
    credentialId:   cred.id, // base64url
    publicKeyDer:   bufToB64url(der),
    clientDataJSON: bufToB64url(resp.clientDataJSON),
  };
}

export interface PasskeyAssertion {
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export async function getPasskeyAssertion(opts: { challenge: string; rpId: string }): Promise<PasskeyAssertion> {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBuf(opts.challenge),
      rpId: opts.rpId,
      userVerification: 'required',
      timeout: 60_000,
      // usernameless: no allowCredentials — the resident key is discovered by the authenticator
    },
  }) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Passkey sign-in was cancelled.');
  const resp = assertion.response as AuthenticatorAssertionResponse;

  return {
    credentialId:      assertion.id,
    authenticatorData: bufToB64url(resp.authenticatorData),
    clientDataJSON:    bufToB64url(resp.clientDataJSON),
    signature:         bufToB64url(resp.signature),
  };
}
