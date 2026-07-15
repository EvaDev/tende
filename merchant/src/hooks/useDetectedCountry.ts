import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface Country {
  code: string;
  name: string;
  dial_code: string;
  currency_code: string;
}

export function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const TZ_COUNTRY: Record<string, string> = {
  'Africa/Johannesburg': 'ZA',
  'Africa/Harare': 'ZW',
  'Africa/Gaborone': 'BW',
  'Africa/Nairobi': 'KE',
  'Africa/Blantyre': 'MW',
  'Africa/Maputo': 'MZ',
  'Africa/Windhoek': 'NA',
  'Africa/Lagos': 'NG',
};

let cache: Country[] | null = null;

export function useDetectedCountry() {
  const [countries, setCountries] = useState<Country[]>(cache ?? []);
  const [country, setCountry] = useState<Country | null>(null);

  useEffect(() => {
    const resolve = (rows: Country[]) => {
      setCountries(rows);
      cache = rows;
      let tz: string | null = null;
      try { tz = TZ_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? null; } catch { /* ignore */ }
      const hit = (tz && rows.find(c => c.code === tz))
        || rows.find(c => c.code === (navigator.language?.split('-')[1]?.toUpperCase() ?? ''))
        || rows[0];
      setCountry(hit ?? null);
    };
    if (cache) { resolve(cache); return; }
    apiFetch<Country[]>('/api/countries').then(resolve).catch(() => {});
  }, []);

  return { country, countries };
}
