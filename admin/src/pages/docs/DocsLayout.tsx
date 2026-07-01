import { NavLink, Outlet } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { useAppName } from '@/hooks/useAppConfig';
import { cn } from '@/lib/utils';

// Multi-page technical docs. One "Docs" item in the main sidebar; the sections
// below are an in-page sub-navigation (nested routes under /docs/*), so they
// don't clutter the main menu. Keep content in sync with the Solidity sources.
const SUB_NAV = [
  { to: 'concepts',  label: 'Concepts' },
  { to: 'payments',  label: 'Payments' },
  { to: 'gas-fees',  label: 'Gas fees' },
  { to: 'contracts', label: 'Contracts' },
  { to: 'functions', label: 'Functions' },
  { to: 'events',    label: 'Events & Reporting' },
  { to: 'api',       label: 'API' },
];

export default function DocsLayout() {
  const appName = useAppName();
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-brand-accent">{appName} — Technical Docs</h2>
        <p className="text-white/80 mt-2 text-sm">
          Operator reference for the platform’s value model, contracts, functions and the on-chain
          events that drive reporting. For a high-level product overview, see the <strong>About</strong> page.
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
                isActive
                  ? 'border-white text-white'
                  : 'border-transparent text-white/60 hover:text-white',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Card className="space-y-8">
        <Outlet />
      </Card>
    </div>
  );
}
