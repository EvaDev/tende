import { useCallback, useEffect, useState } from 'react';
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
  settlement_type: string | null;
  settlement_currency: string | null;
  icon_id: number | null;
  verification_status: string;
  created_at: string;
}

export function refreshMerchantProfile() {
  window.dispatchEvent(new Event('merchant-profile-refresh'));
}

export function useMerchantProfile() {
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<MerchantProfile>('/api/merchant/me')
      .then(setMerchant)
      .catch(() => setMerchant(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('merchant-profile-refresh', load);
    return () => window.removeEventListener('merchant-profile-refresh', load);
  }, [load]);

  return { merchant, loading };
}
