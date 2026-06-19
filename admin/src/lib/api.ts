// Thin API client — wraps fetch with auth header injection and error handling.

export class AuthError extends Error { constructor() { super('Session expired'); this.name = 'AuthError'; } }

let _token: string | null = null;

export function setAuthToken(t: string | null) { _token = t; }
export function getAuthToken() { return _token; }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:   <T>(path: string)                    => request<T>(path),
  post:  <T>(path: string, body: unknown)     => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown)     => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del:   <T>(path: string)                    => request<T>(path, { method: 'DELETE' }),
};

export function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init);
}
