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

interface TreasuryInstance {
  symbol: string;
  name: string;
  fiat_code: string;
  proxy_address: string;
  is_deployed: boolean;
}

interface TreasuryInstancesResponse {
  sharedImplementation: string | null;
  instances: TreasuryInstance[];
}

const short = (a?: string | null) => a ? `${a.slice(0, 8)}…${a.slice(-6)}` : '—';

const CHAIN_NAMES: Record<number, string> = { 1: 'Ethereum Mainnet', 11155111: 'Sepolia Testnet' };
const chainName = (id: number) => CHAIN_NAMES[id] ?? `Chain ${id}`;

const coreCols: Col<Deployment>[] = [
  { key: 'contract', header: 'Contract',
    sort: d => d.contract_name, search: d => d.contract_name,
    className: 'px-4 py-3 font-medium text-gray-900',
    render: d => d.contract_name },
  { key: 'proxy', header: 'Proxy / Address',
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

const instanceCols: Col<TreasuryInstance>[] = [
  { key: 'symbol', header: 'Symbol', sort: i => i.symbol, search: i => i.symbol,
    render: i => <span className="font-mono font-bold">{i.symbol}</span> },
  { key: 'name', header: 'Name', sort: i => i.name, search: i => i.name,
    render: i => i.name },
  { key: 'fiat', header: 'Fiat anchor', sort: i => i.fiat_code ?? '', search: i => i.fiat_code ?? '',
    render: i => i.fiat_code ?? '—' },
  { key: 'proxy', header: 'Instance (proxy)', search: i => i.proxy_address,
    className: 'font-mono text-xs',
    render: i => (
      <a href={`https://sepolia.etherscan.io/address/${i.proxy_address}`} target="_blank" rel="noreferrer" className="underline hover:text-brand-accent">
        {short(i.proxy_address)}
      </a>
    ) },
  { key: 'status', header: 'Status', sort: i => (i.is_deployed ? 1 : 0),
    render: i => (
      <Badge className={i.is_deployed ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}>
        {i.is_deployed ? 'Deployed' : 'Pending'}
      </Badge>
    ) },
];

export default function Contracts() {
  const { isAdmin } = useRole();
  const publicPages = usePublicPages();
  const canView = isAdmin || publicPages.includes('contracts');
  const [rows, setRows]   = useState<Deployment[] | null>(null);
  const [instances, setInstances] = useState<TreasuryInstancesResponse | null>(null);
  const [error, setError] = useState<'auth' | 'other' | null>(null);

  function load() {
    apiFetch<Deployment[]>('/api/admin/contract-deployments')
      .then(r => { setRows(r); setError(null); })
      .catch(e => setError(e instanceof AuthError ? 'auth' : 'other'));
    apiFetch<TreasuryInstancesResponse>('/api/admin/treasury-instances')
      .then(setInstances)
      .catch(() => {});
  }

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView]);

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
    <div className="space-y-6 max-w-4xl">
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
          cols={coreCols}
          rows={rows ?? []}
          initialSort={{ key: 'contract', dir: 'asc' }}
          searchable
          searchPlaceholder="Search contract or address…"
        />
        <p className="text-sm text-gray-700 px-4 py-3 border-t bg-gray-50 leading-relaxed">
          Three core platform contracts: Consumer, Vault, and TreasuryToken (shared logic).
          Each corridor token is a separate <strong>proxy instance</strong> registered in
          stablecoins — see below.
        </p>
      </Card>

      <div>
        <h3 className="text-lg font-semibold text-brand-accent mb-3">Treasury token instances</h3>
        <Card className="p-0 overflow-hidden">
          {instances?.sharedImplementation && (
            <div className="px-4 py-3 border-b bg-white text-sm text-gray-800 leading-relaxed">
              <span className="font-medium text-gray-900">Shared implementation</span>
              {' '}
              <a
                href={`https://sepolia.etherscan.io/address/${instances.sharedImplementation}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline hover:text-brand-accent"
                title={instances.sharedImplementation}
              >
                {short(instances.sharedImplementation)}
              </a>
              {' '}
              — all corridor proxies delegate to this logic; upgrading it upgrades every token.
            </div>
          )}
          <SortableTable
            cols={instanceCols}
            rows={instances?.instances ?? []}
            initialSort={{ key: 'symbol', dir: 'asc' }}
            searchable
            searchPlaceholder="Search symbol, name, fiat…"
          />
        </Card>
      </div>
    </div>
  );
}
