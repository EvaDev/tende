import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface Country {
  code: string;
  name: string;
  dial_code: string;
  currency_code: string;
}

// Country code → flag emoji via regional indicator symbols.
export function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Timezone → country. The browser timezone reflects physical location far more
// reliably than the UI language (an SA user on an en-US browser still has
// Africa/Johannesburg). Covers the supported operating countries.
const TZ_COUNTRY: Record<string, string> = {
  'Africa/Johannesburg': 'ZA',
  'Africa/Harare':       'ZW',
  'Africa/Gaborone':     'BW',
  'Africa/Nairobi':      'KE',
  'Africa/Blantyre':     'MW',
  'Africa/Maputo':       'MZ',
  'Africa/Windhoek':     'NA',
  'Africa/Lagos':        'NG',
};

function detectByTimezone(): string | null {
  try { return TZ_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? null; }
  catch { return null; }
}

// Ordered candidate region codes from the browser locale(s) — used as a fallback.
function candidateRegions(): string[] {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs
    .map(l => l?.split('-')[1]?.toUpperCase())
    .filter((r): r is string => !!r && /^[A-Z]{2}$/.test(r));
}

let cache: Country[] | null = null;

/**
 * Detects the operating country from the browser locale, validated against the
 * supported countries from the DB. First locale region that is a supported
 * country wins; otherwise the first active country. Returns `null` until loaded.
 *
 * Currency rule (applied by callers): the country's own currency is allowed,
 * plus USD which is available in every country.
 */
export function useDetectedCountry() {
  const [countries, setCountries] = useState<Country[]>(cache ?? []);
  const [country, setCountry]     = useState<Country | null>(null);

  useEffect(() => {
    const resolve = (rows: Country[]) => {
      // Timezone wins (physical location); then browser-locale region; then first active.
      const tzCode  = detectByTimezone();
      const tzMatch = tzCode ? rows.find(c => c.code === tzCode) : undefined;
      const regions = candidateRegions();
      const localeMatch = regions.map(r => rows.find(c => c.code === r)).find(Boolean);
      setCountry(tzMatch ?? localeMatch ?? rows[0] ?? null);
    };
    if (cache) { setCountries(cache); resolve(cache); return; }
    apiFetch<Country[]>('/api/countries')
      .then(rows => { cache = rows; setCountries(rows); resolve(rows); })
      .catch(() => {});
  }, []);

  // Currencies allowed for the detected country: its own + USD (everywhere).
  const allowedCurrencies = country
    ? Array.from(new Set([country.currency_code, 'USD']))
    : ['USD'];

  return { country, countries, allowedCurrencies };
}
