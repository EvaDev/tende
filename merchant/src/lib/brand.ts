// Mirrors consumer/src/lib/brand.ts — fetches brand colours from /api/config
// and applies them to :root CSS variables.

import { api } from './api';
import defaultLogo from '@/assets/iMali_icon.png';

let _appName = '';
export function getAppName(): string { return _appName; }

let _appLogo = '';
export function getAppLogo(): string { return _appLogo || defaultLogo; }

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function setFavicon(href: string) {
  const link = (document.querySelector("link[rel~='icon']") as HTMLLinkElement)
    ?? document.createElement('link');
  link.rel = 'icon';
  link.href = href;
  if (!link.parentElement) document.head.appendChild(link);
}

function applyAppName(name: string) {
  _appName = name;
  if (name) document.title = `${name} Merchant`;
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
    const cfg = await api.get<Record<string, string>>('/api/config');
    applyBrandColors(cfg);
    if ('app.name' in cfg) applyAppName(cfg['app.name'] ?? '');
    if (cfg['app.logo']) {
      _appLogo = cfg['app.logo'];
      setFavicon(_appLogo);
    } else {
      setFavicon(defaultLogo);
    }
  } catch {
    setFavicon(defaultLogo);
  }
}
