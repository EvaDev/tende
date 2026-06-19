import { useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { loginWithWallet, restoreToken } from '@/lib/auth';

export type Role = 'admin' | 'merchant' | 'none';

// Trigger a role re-probe (e.g. right after merchant self-registration).
export function refreshRole() { window.dispatchEvent(new Event('role-refresh')); }

export function useRole(): { role: Role; isAdmin: boolean; isMerchant: boolean; resolved: boolean } {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [role, setRole]         = useState<Role>('none');
  const [resolved, setResolved] = useState(false);
  const [tick, setTick]         = useState(0);

  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('role-refresh', h);
    return () => window.removeEventListener('role-refresh', h);
  }, []);

  useEffect(() => {
    if (!isConnected || !address) { setRole('none'); setResolved(true); return; }
    const addr = address.toLowerCase();
    let cancelled = false;
    setResolved(false);

    // 1. Read-only probe — no signature. Decides known wallet vs new wallet.
    fetch(`/api/auth/role?wallet=${addr}`)
      .then(r => r.json())
      .then(async ({ role: probed }: { role: Role }) => {
        if (cancelled) return;
        setRole(probed);
        // 2. Known wallet with no token yet → sign once to obtain a JWT for writes.
        if (probed !== 'none' && !restoreToken()) {
          try { await loginWithWallet(addr, (msg) => signMessageAsync({ message: msg })); } catch { /* user rejected */ }
        }
        // New wallet (probed === 'none') signs only on merchant-signup submit.
        if (!cancelled) setResolved(true);
      })
      .catch(() => { if (!cancelled) { setRole('none'); setResolved(true); } });

    return () => { cancelled = true; };
  }, [isConnected, address, tick]);

  return { role, isAdmin: role === 'admin', isMerchant: role === 'merchant', resolved };
}
