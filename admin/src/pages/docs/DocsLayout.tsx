import { useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppName } from '@/hooks/useAppConfig';
import { cn } from '@/lib/utils';
import { exportElementToPdf } from '@/lib/exportDocsPdf';

// Multi-page technical docs. One "Docs" item in the main sidebar; the sections
// below are an in-page sub-navigation (nested routes under /docs/*), so they
// don't clutter the main menu. Keep content in sync with the Solidity sources.
const SUB_NAV = [
  { to: 'concepts',  label: 'Concepts' },
  { to: 'payments',  label: 'Payments' },
  { to: 'gas-fees',  label: 'Gas fees' },
  { to: 'merchant',  label: 'Merchant' },
  { to: 'contracts', label: 'Contracts' },
  { to: 'functions', label: 'Functions' },
  { to: 'events',    label: 'Events & Reporting' },
  { to: 'api',       label: 'API' },
];

function sectionSlug(pathname: string): string {
  const part = pathname.split('/').filter(Boolean).pop() ?? 'docs';
  return part === 'docs' ? 'concepts' : part;
}

export default function DocsLayout() {
  const appName = useAppName();
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExportPdf() {
    if (!contentRef.current || exporting) return;
    setError(null);
    setExporting(true);
    try {
      const slug = sectionSlug(location.pathname);
      const filename = `${appName.toLowerCase().replace(/\s+/g, '-')}-docs-${slug}.pdf`;
      await exportElementToPdf(contentRef.current, filename);
    } catch (err) {
      setError((err as Error).message || 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-brand-accent">{appName} — Technical Docs</h2>
          <p className="text-white/80 mt-2 text-sm">
            Operator reference for the platform’s value model, contracts, functions and the on-chain
            events that drive reporting. For a high-level product overview, see the <strong>About</strong> page.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={handleExportPdf}
          disabled={exporting}
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export PDF'}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-red-200 bg-red-900/40 px-3 py-2 rounded-lg">{error}</p>
      )}

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
        <div ref={contentRef}>
          <Outlet />
        </div>
      </Card>
    </div>
  );
}
