import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SortableTable, type Col } from '@/components/SortableTable';
import { apiFetch, AuthError } from '@/lib/api';
import { useRole } from '@/hooks/useRole';
import { usePublicPages } from '@/hooks/useAppConfig';

interface Deployment {
  contract_name: string;
  proxy_address: string;
  version: string | null;
  chain_id: number;
  notes: string | null;
  liveImpl: string | null;
  onChainVersion: string | null;
}

const short = (a?: string | null) => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—';

const CHAIN_NAMES: Record<number, string> = { 1: 'Ethereum Mainnet', 11155111: 'Sepolia Testnet' };
const chainName = (id: number) => CHAIN_NAMES[id] ?? `Chain ${id}`;

const cols: Col<Deployment>[] = [
  { key: 'contract', header: 'Contract',
    sort: d => d.contract_name, search: d => d.contract_name,
    className: 'px-4 py-3 font-medium text-gray-900',
    render: d => d.contract_name },
  { key: 'proxy', header: 'Proxy',
    search: d => d.proxy_address,
    className: 'px-4 py-3 font-mono text-xs text-gray-600',
    render: d => <span title={d.proxy_address}>{short(d.proxy_address)}</span> },
  { key: 'liveImpl', header: 'Live Implementation',
    search: d => d.liveImpl ?? '',
    className: 'px-4 py-3 font-mono text-xs text-gray-600',
    render: d => <span title={d.liveImpl ?? ''}>{short(d.liveImpl)}</span> },
  { key: 'onChainVersion', header: 'On-chain Version',
    className: 'px-4 py-3',
    render: d => d.onChainVersion
      ? <Badge className="bg-brand-accent/10 text-brand-accent">{d.onChainVersion}</Badge>
      : <span className="text-xs text-brand-accent">redeploy pending</span> },
  { key: 'recorded', header: 'Recorded',
    className: 'px-4 py-3 text-gray-600',
    render: d => d.version ?? '—' },
  { key: 'chain', header: 'Chain',
    sort: d => d.chain_id,
    className: 'px-4 py-3 text-gray-500',
    render: d => (
      <>
        <div className="text-gray-700">{chainName(d.chain_id)}</div>
        <div className="text-xs text-gray-400">{d.chain_id}</div>
      </>
    ) },
  { key: 'notes', header: 'Notes',
    className: 'px-4 py-3 text-xs text-gray-500',
    render: d => d.notes ?? '' },
];

export default function Contracts() {
  const { isAdmin } = useRole();
  const publicPages = usePublicPages();
  const canView = isAdmin || publicPages.includes('contracts');
  const [rows, setRows]   = useState<Deployment[] | null>(null);
  const [error, setError] = useState<'auth' | 'other' | null>(null);

  useEffect(() => {
    if (!canView) return;
    apiFetch<Deployment[]>('/api/admin/contract-deployments')
      .then(r => { setRows(r); setError(null); })
      .catch(e => setError(e instanceof AuthError ? 'auth' : 'other'));
  }, [canView]);

  // Admin-only unless opted into public read-only viewing (Settings → Public pages).
  if (!canView) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold text-brand-accent mb-3">Contracts</h2>
        <Card>
          <p className="text-sm text-gray-600">
            Connect the <strong>administrator wallet</strong> to view contract deployments and live versions.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <h2 className="text-xl font-semibold text-brand-accent">Contract Deployments</h2>

      {error === 'auth' && (
        <div className="rounded-xl border border-brand-accent/30 bg-brand-accent/10 px-4 py-3 text-sm text-brand-accent">
          Admin session expired — disconnect and reconnect your wallet to reload.
        </div>
      )}
      {error === 'other' && (
        <div className="rounded-xl border border-brand-danger/30 bg-brand-danger/10 px-4 py-3 text-sm text-brand-danger">
          Could not load deployments. Check the backend and RPC connection.
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <SortableTable
          cols={cols}
          rows={rows ?? []}
          initialSort={{ key: 'contract', dir: 'asc' }}
          searchable
          searchPlaceholder="Search contract or address…"
        />
        <p className="text-xs text-gray-500 px-4 py-3 border-t bg-gray-50">
          <strong>Live Implementation</strong> is read from each proxy's ERC-1967 slot at request time —
          it changes on every UUPS upgrade. <strong>On-chain Version</strong> reads the contract's
          <code> VERSION()</code>; it shows “redeploy pending” until the deployed bytecode includes the
          version constant.
        </p>
      </Card>
    </div>
  );
}
