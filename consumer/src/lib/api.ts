const API = '/api';

let _token: string | null = localStorage.getItem('imali_jwt');

export function setToken(t: string | null) {
  _token = t;
  if (t) localStorage.setItem('imali_jwt', t);
  else localStorage.removeItem('imali_jwt');
}
export function getToken() { return _token; }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (res.status === 401) { setToken(null); window.location.hash = '/login'; }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:  <T>(path: string)               => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};
