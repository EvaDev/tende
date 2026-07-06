// Thin API client — wraps fetch with auth header injection and error handling.
// Mirrors admin/src/lib/api.ts; the only difference is the localStorage key and
// the refresh event name (member-refresh, not role-refresh).

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
  if (res.status === 401) {
    _token = null;
    try { localStorage.removeItem('member_auth_token'); } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('member-refresh')); } catch { /* ignore */ }
    throw new AuthError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; memberId?: number; status?: string };
    const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & { memberId?: number; status?: string };
    if (body.memberId != null) err.memberId = body.memberId;
    if (body.status) err.status = body.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:   <T>(path: string)                => request<T>(path),
  post:  <T>(path: string, body: unknown) => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put:   <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT',   body: JSON.stringify(body) }),
  del:   <T>(path: string)                => request<T>(path, { method: 'DELETE' }),
};

export function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init);
}
