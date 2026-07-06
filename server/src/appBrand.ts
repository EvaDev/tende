// Platform display name — single source of truth is app_config `app.name`.
import db from './db.js';

const TTL_MS = 60_000;
let cache: { name: string; expiresAt: number } | null = null;

export async function getAppDisplayName(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) return cache.name;
  try {
    const r = await db.query<{ value: string }>(
      `SELECT value FROM app_config WHERE key = 'app.name' LIMIT 1`,
    );
    const name = r.rows[0]?.value?.trim() ?? '';
    cache = { name, expiresAt: Date.now() + TTL_MS };
    return name;
  } catch {
    return '';
  }
}

export function invalidateAppBrandCache(): void {
  cache = null;
}
