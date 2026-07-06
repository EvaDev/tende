// Mirrors admin/src/config/app.ts — same CSS variables, same logic.
// Fetches brand colours from /api/config and applies them to :root.

import { api } from './api';
import defaultLogo from '@/assets/iMali_icon.png';

// ENS parent domain — fetched from the server (single source of truth, set via
// ENS_PARENT_DOMAIN env var). Never hardcode the domain in components.
let _ensParentDomain = '';
export function getEnsParentDomain(): string { return _ensParentDomain; }

// App/brand name — fetched from the server (app.name config). Never hardcode.
let _appName = '';
export function getAppName(): string { return _appName; }

// App logo — fetched from the server (app.logo config). Bundled asset is fallback only.
let _appLogo = '';
export function getAppLogo(): string { return _appLogo || defaultLogo; }

const brandListeners = new Set<() => void>();

export function subscribeAppBrand(fn: () => void): () => void {
  brandListeners.add(fn);
  return () => { brandListeners.delete(fn); };
}

function notifyBrandListeners() {
  brandListeners.forEach(fn => fn());
}

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
  if (name) {
    document.title = name;
    let meta = document.querySelector('meta[name="apple-mobile-web-app-title"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'apple-mobile-web-app-title';
      document.head.appendChild(meta);
    }
    meta.content = name;
  }
  notifyBrandListeners();
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
    if ('app.name' in cfg) applyAppName(cfg['app.name'] ?? '');
    if (cfg['app.logo']) {
      _appLogo = cfg['app.logo'];
      setFavicon(_appLogo);
    } else {
      setFavicon(defaultLogo);
    }
    notifyBrandListeners();
  } catch {
    setFavicon(defaultLogo);
  }
}
