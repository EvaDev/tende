import { useCallback, useEffect, useState } from 'react';
import { api, AuthError } from '@/lib/api';
import { restoreToken, logout as clearSession } from '@/lib/memberAuth';

export interface MemberProfile {
  memberId: number;
  merchantId: string;
  merchantName: string;
  email: string | null;
  displayName: string | null;
  role: 'org_admin' | 'store_manager' | 'cashier';
  status: string;
}

export function useMember() {
  const [member, setMember]   = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = restoreToken();
    if (!token) { setMember(null); setLoading(false); return; }
    setLoading(true);
    try {
      const profile = await api.get<MemberProfile>('/api/member-auth/me');
      setMember(profile);
    } catch (err) {
      if (err instanceof AuthError) clearSession();
      setMember(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('member-refresh', refresh);
    return () => window.removeEventListener('member-refresh', refresh);
  }, [refresh]);

  const signOut = useCallback(() => {
    clearSession();
    setMember(null);
  }, []);

  return { member, loading, isOrgAdmin: member?.role === 'org_admin', refresh, signOut };
}
