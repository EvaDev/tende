// Mirrors admin/src/config/app.ts — same CSS variables, same logic.
// Fetches brand colours from /api/config and applies them to :root.

import { api } from './api';

// ENS parent domain — fetched from the server (single source of truth, set via
// ENS_PARENT_DOMAIN env var). Never hardcode the domain in components.
let _ensParentDomain = '';
export function getEnsParentDomain(): string { return _ensParentDomain; }

// App/brand name — fetched from the server (app.name config). Never hardcode.
let _appName = '';
export function getAppName(): string { return _appName; }

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function applyBrandColors(cfg: Record<string, string>) {
  const root = document.documentElement;
  const bg     = cfg['brand.color.bg'];
  const accent = cfg['brand.color.accent'];
  const text   = cfg['brand.color.text'];
  if (bg)     root.style.setProperty('--color-bg',     hexToRgb(bg));
  if (accent) root.style.setProperty('--color-accent', hexToRgb(accent));
  if (text)   root.style.setProperty('--color-text',   hexToRgb(text));
}

export async function loadBrandColors(): Promise<void> {
  try {
    const cfg = await api.get<Record<string, string>>('/config');
    applyBrandColors(cfg);
    if (cfg['ens.parent_domain']) _ensParentDomain = cfg['ens.parent_domain'];
    if (cfg['app.name']) _appName = cfg['app.name'];
  } catch {
    // Defaults in :root CSS vars are already applied — nothing to do.
  }
}
