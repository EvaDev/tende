// Wallet-based JWT auth — sign nonce → receive JWT with role:'admin'
import { api, setAuthToken } from './api';

// Dedupe concurrent logins for the same wallet. Without this, React StrictMode's
// double-invoked effects (and wagmi connect re-renders) fire loginWithWallet more
// than once: each call issues a fresh server nonce, and the store keeps only the
// last one — so the signature over an earlier nonce fails verification (401) and a
// second MetaMask prompt appears ("User rejected"). Sharing one in-flight promise
// per wallet guarantees a single nonce, a single prompt, and a single login POST.
let inFlight: { addr: string; promise: Promise<{ token: string; role: string }> } | null = null;

export async function loginWithWallet(
  address: string,
  signMessage: (msg: string) => Promise<string>,
): Promise<{ token: string; role: string }> {
  const addr = address.toLowerCase();
  if (inFlight && inFlight.addr === addr) return inFlight.promise;

  const promise = (async () => {
    const { message } = await api.get<{ nonce: string; message: string }>(`/api/auth/nonce?wallet=${addr}`);
    const signature   = await signMessage(message);
    const result      = await api.post<{ token: string; role: string }>('/api/auth/login', { walletAddress: addr, signature });
    setAuthToken(result.token);
    localStorage.setItem('auth_token', result.token);
    return result;
  })();

  inFlight = { addr, promise };
  try { return await promise; }
  finally { inFlight = null; }
}

// Decode a JWT's `exp` (seconds) without verifying the signature. base64url-safe.
function tokenExp(token: string): number | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// An absent/unparseable exp is treated as expired — safer to re-login than to
// attach a token the backend will reject.
function isExpired(token: string): boolean {
  const exp = tokenExp(token);
  return exp == null || exp * 1000 <= Date.now();
}

// Restore a *valid* JWT from localStorage. An expired token is purged and null is
// returned, so useRole's `!restoreToken()` check re-triggers the sign-in flow
// instead of silently attaching a dead token (which caused the stuck
// "session expired" loop where reconnecting never recovered).
export function restoreToken(): string | null {
  const t = localStorage.getItem('auth_token');
  if (!t) return null;
  if (isExpired(t)) { logout(); return null; }
  setAuthToken(t);
  return t;
}

export function logout() {
  setAuthToken(null);
  localStorage.removeItem('auth_token');
}
