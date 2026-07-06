import { useCallback, useEffect, useState } from 'react';
import { getAuthToken } from '@/lib/api';

export function useMerchantLogo(enabled = true) {
  const [logoSrc, setLogoSrc] = useState<string | undefined>(undefined);

  const load = useCallback(() => {
    if (!enabled) return;
    const token = getAuthToken();
    fetch('/api/merchant/me/logo', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (!blob) { setLogoSrc(undefined); return; }
        const reader = new FileReader();
        reader.onload = e => setLogoSrc(e.target?.result as string);
        reader.readAsDataURL(blob);
      })
      .catch(() => setLogoSrc(undefined));
  }, [enabled]);

  useEffect(() => {
    load();
    window.addEventListener('merchant-logo-refresh', load);
    window.addEventListener('merchant-profile-refresh', load);
    return () => {
      window.removeEventListener('merchant-logo-refresh', load);
      window.removeEventListener('merchant-profile-refresh', load);
    };
  }, [load]);

  return logoSrc;
}
