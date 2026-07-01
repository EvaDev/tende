import { NavLink, Outlet } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Multi-page reports over the indexed chain_events (admin-only endpoints under
// /api/admin/reports). One "Reports" sidebar item; the sections are in-page sub-nav.
const SUB_NAV = [
  { to: 'summary',   label: 'Summary' },
  { to: 'events',    label: 'Event Feed' },
  { to: 'transfers', label: 'Transfers' },
  { to: 'treasury',  label: 'Mint & Burn' },
  { to: 'revenue',   label: 'Revenue' },
];

export default function ReportsLayout() {
  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-brand-accent">Reports</h2>
        <p className="text-white/80 mt-2 text-sm">
          On-chain activity indexed from the contracts. The chain is the source of truth; these
          views are read-only projections for ops, compliance and revenue.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-white/20">
        {SUB_NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'px-3 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors',
                isActive ? 'border-white text-white' : 'border-transparent text-white/60 hover:text-white',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Card className="space-y-5">
        <Outlet />
      </Card>
    </div>
  );
}
