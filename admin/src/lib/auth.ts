// Wallet-based JWT auth — sign nonce → receive JWT with role:'admin'
import { api, setAuthToken } from './api';

export async function loginWithWallet(
  address: string,
  signMessage: (msg: string) => Promise<string>,
): Promise<{ token: string; role: string }> {
  const { message } = await api.get<{ nonce: string; message: string }>(`/api/auth/nonce?wallet=${address}`);
  const signature    = await signMessage(message);
  const result       = await api.post<{ token: string; role: string }>('/api/auth/login', { walletAddress: address, signature });
  setAuthToken(result.token);
  localStorage.setItem('auth_token', result.token);
  return result;
}

export function restoreToken() {
  const t = localStorage.getItem('auth_token');
  if (t) setAuthToken(t);
  return t;
}

export function logout() {
  setAuthToken(null);
  localStorage.removeItem('auth_token');
}
