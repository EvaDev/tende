import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface MerchantProfile {
  merchant_id: string;
  name: string;
  wallet_address: string;
  country_code: string;
  currency_code: string;
  email: string | null;
  address: string | null;
  contact_person: string | null;
  settlement_type: string;
  settlement_currency: string;
  icon_id: number | null;
  verification_status: string;
  created_at: string;
}

// Re-fetch the connected merchant's profile (e.g. after a self-edit save).
export function refreshMerchant() { window.dispatchEvent(new Event('merchant-refresh')); }

// Loads GET /api/merchants/me for the connected merchant. `enabled` should be
// `role === 'merchant'` so we don't fire the request for admins/visitors. Keeps
// its own probe out of useRole to avoid duplicate role/sign-in flows.
export function useMerchant(enabled: boolean): {
  merchant: MerchantProfile | null; loading: boolean; reload: () => void;
} {
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [loading, setLoading]   = useState(false);
  const [tick, setTick]         = useState(0);

  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('merchant-refresh', h);
    return () => window.removeEventListener('merchant-refresh', h);
  }, []);

  useEffect(() => {
    if (!enabled) { setMerchant(null); return; }
    let cancelled = false;
    setLoading(true);
    apiFetch<MerchantProfile>('/api/merchants/me')
      .then(m => { if (!cancelled) setMerchant(m); })
      .catch(() => { if (!cancelled) setMerchant(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, tick]);

  return { merchant, loading, reload: () => setTick(t => t + 1) };
}
