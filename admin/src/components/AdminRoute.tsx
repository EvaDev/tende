import { type ReactNode } from 'react';
import { useRole } from '@/hooks/useRole';

// Gate a route to the admin wallet. The nav already hides admin-only items; this
// also blocks direct-URL access, showing a friendly notice for non-admins.
// (Layout renders the probing spinner before the Outlet, so role is resolved here.)
export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, resolved } = useRole();
  if (!resolved) return null;
  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-20 rounded-xl border border-brand-accent/20 bg-white p-6 text-center">
        <h3 className="text-lg font-semibold text-brand-accent">Admin access required</h3>
        <p className="text-sm text-gray-600 mt-2">
          Connect the admin wallet to view this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
