import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { APP_DEFAULTS, applyBrandColors } from '@/config/app';

interface AppConfig {
  'app.name'?: string;
  'app.logo'?: string;
  'brand.color.bg'?: string;
  'brand.color.accent'?: string;
  'brand.color.text'?: string;
  [key: string]: string | undefined;
}

let cache: AppConfig | null = null;

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(cache ?? {});

  useEffect(() => {
    if (cache) { applyBrandColors(cache as any); return; }
    apiFetch<Record<string, string>>('/api/config')
      .then((data: Record<string, string>) => {
        cache = data as AppConfig;
        applyBrandColors(data);
        setConfig(data as AppConfig);
      })
      .catch(() => {});
  }, []);

  return config;
}

export function useAppName() {
  const config = useAppConfig();
  return config['app.name'] ?? APP_DEFAULTS.name;
}

// Admin page keys opted into public (no-login) read-only viewing, from the
// `app.public_pages` config (CSV). Empty when nothing is exposed.
export function usePublicPages(): string[] {
  const config = useAppConfig();
  return (config['app.public_pages'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
}
