// Brand identity — app name only.
// Colors have NO hardcoded defaults here; they come exclusively from the DB
// via GET /api/config/all. If that call fails, the UI shows an error rather
// than silently using a stale or wrong colour.
export const APP_DEFAULTS = {
  name: 'iMali',
} as const;

export function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function applyBrandColors(cfg: { background?: string; accent?: string; text?: string } | Record<string, string>) {
  const root = document.documentElement;
  const bg     = (cfg as Record<string, string>)['brand.color.bg']     ?? (cfg as any).background;
  const accent = (cfg as Record<string, string>)['brand.color.accent'] ?? (cfg as any).accent;
  const text   = (cfg as Record<string, string>)['brand.color.text']   ?? (cfg as any).text;
  if (bg)     root.style.setProperty('--color-bg',     hexToRgb(bg));
  if (accent) root.style.setProperty('--color-accent', hexToRgb(accent));
  if (text)   root.style.setProperty('--color-text',   hexToRgb(text));
}
