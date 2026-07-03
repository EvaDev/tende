import type { ReactNode } from 'react';
import { useMember } from '@/hooks/useMember';

export function RequireOrgAdmin({ children }: { children: ReactNode }) {
  const { isOrgAdmin } = useMember();
  if (!isOrgAdmin) {
    return (
      <div className="max-w-md mx-auto mt-20 rounded-xl border border-brand-danger/30 bg-brand-danger/10 p-6 text-center">
        <h3 className="text-lg font-semibold text-brand-danger">Head office access required</h3>
        <p className="text-sm text-brand-danger/80 mt-2">
          Only an org admin (head office) can view this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
