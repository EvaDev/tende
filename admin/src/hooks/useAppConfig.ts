import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { APP_DEFAULTS, applyBrandColors, applyAppLogo, getAppLogo } from '@/config/app';
import defaultLogo from '@/assets/iMali_icon.png';

interface AppConfig {
  'app.name'?: string;
  'app.logo'?: string;
  'brand.color.bg'?: string;
  'brand.color.accent'?: string;
  'brand.color.text'?: string;
  [key: string]: string | undefined;
}

let cache: AppConfig | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(fn => fn());
}

export function invalidateAppConfigCache() {
  cache = null;
}

export async function refreshAppConfig(): Promise<AppConfig> {
  const data = await apiFetch<Record<string, string>>('/api/config');
  cache = data as AppConfig;
  applyBrandColors(data);
  applyAppLogo(data['app.logo']);
  notifyListeners();
  return cache;
}

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(cache ?? {});

  useEffect(() => {
    const onUpdate = () => setConfig(cache ?? {});
    listeners.add(onUpdate);

    if (cache) {
      applyBrandColors(cache as Record<string, string>);
      applyAppLogo(cache['app.logo']);
      setConfig(cache);
    } else {
      refreshAppConfig().then(setConfig).catch(() => {});
    }

    return () => { listeners.delete(onUpdate); };
  }, []);

  return config;
}

export function useAppName() {
  const config = useAppConfig();
  return config['app.name'] ?? APP_DEFAULTS.name;
}

export function useAppLogo(): string {
  const config = useAppConfig();
  return config['app.logo'] ?? getAppLogo() ?? defaultLogo;
}

// Admin page keys opted into public (no-login) read-only viewing, from the
// `app.public_pages` config (CSV). Empty when nothing is exposed.
export function usePublicPages(): string[] {
  const config = useAppConfig();
  return (config['app.public_pages'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
}
