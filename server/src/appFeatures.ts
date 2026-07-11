// appFeatures.ts — runtime feature flags from app_config (cached).

import db from './db.js';

let cache: Record<string, boolean> | null = null;
let cacheAt = 0;
const TTL_MS = 15_000;

async function load(): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  const result = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM app_config WHERE key LIKE 'feature.%'`,
  );
  const next: Record<string, boolean> = {};
  for (const row of result.rows) next[row.key] = row.value === 'true';
  cache = next;
  cacheAt = now;
  return next;
}

export function invalidateFeatureCache(): void {
  cache = null;
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flags = await load();
  return flags[key] === true;
}

export async function sessionKeysEnabled(): Promise<boolean> {
  return isFeatureEnabled('feature.session_keys');
}
