import { useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { loginWithWallet, restoreToken } from '@/lib/auth';

export type Role = 'admin' | 'merchant' | 'none';

// Trigger a role re-probe (e.g. right after merchant self-registration).
export function refreshRole() { window.dispatchEvent(new Event('role-refresh')); }

export function useRole(): { role: Role; isAdmin: boolean; isMerchant: boolean; resolved: boolean; error: boolean } {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [role, setRole]         = useState<Role>('none');
  const [resolved, setResolved] = useState(false);
  const [error, setError]       = useState(false);
  const [tick, setTick]         = useState(0);

  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('role-refresh', h);
    return () => window.removeEventListener('role-refresh', h);
  }, []);

  useEffect(() => {
    if (!isConnected || !address) { setRole('none'); setError(false); setResolved(true); return; }
    const addr = address.toLowerCase();
    let cancelled = false;
    setResolved(false);
    setError(false);

    // 1. Read-only probe — no signature. Decides known wallet vs new wallet.
    fetch(`/api/auth/role?wallet=${addr}`)
      .then(async r => {
        if (!r.ok) throw new Error(`role probe ${r.status}`);
        const { role: probed } = await r.json() as { role: Role };
        if (cancelled) return;
        setRole(probed);
        // 2. Known wallet with no (valid) token yet → sign once to obtain a JWT.
        if (probed !== 'none' && !restoreToken()) {
          try { await loginWithWallet(addr, (msg) => signMessageAsync({ message: msg })); } catch { /* user rejected */ }
        }
        // New wallet (probed === 'none') signs only on merchant-signup submit.
        if (!cancelled) setResolved(true);
      })
      .catch(() => {
        // Backend unreachable/erroring. Do NOT assume 'none' — that wrongly drops a
        // real admin into the merchant signup (the "it thinks I'm a merchant" bug).
        // Flag the error so the UI shows a clear message instead.
        if (!cancelled) { setError(true); setResolved(true); }
      });

    return () => { cancelled = true; };
  }, [isConnected, address, tick]);

  return { role, isAdmin: role === 'admin', isMerchant: role === 'merchant', resolved, error };
}
