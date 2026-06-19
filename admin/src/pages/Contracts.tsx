import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiFetch, AuthError } from '@/lib/api';
import { useRole } from '@/hooks/useRole';

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

export default function Contracts() {
  const { isAdmin } = useRole();
  const [rows, setRows]   = useState<Deployment[] | null>(null);
  const [error, setError] = useState<'auth' | 'other' | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch<Deployment[]>('/api/admin/contract-deployments')
      .then(r => { setRows(r); setError(null); })
      .catch(e => setError(e instanceof AuthError ? 'auth' : 'other'));
  }, [isAdmin]);

  // Admin-only: never shown to merchants or unconnected wallets.
  if (!isAdmin) {
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
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Admin session expired — disconnect and reconnect your wallet to reload.
        </div>
      )}
      {error === 'other' && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load deployments. Check the backend and RPC connection.
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['Contract', 'Proxy', 'Live Implementation', 'On-chain Version', 'Recorded', 'Chain', 'Notes'].map(h =>
              <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows === null && !error && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
            )}
            {rows?.map(d => (
              <tr key={d.contract_name} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{d.contract_name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600" title={d.proxy_address}>{short(d.proxy_address)}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600" title={d.liveImpl ?? ''}>{short(d.liveImpl)}</td>
                <td className="px-4 py-3">
                  {d.onChainVersion
                    ? <Badge className="bg-green-100 text-green-800">{d.onChainVersion}</Badge>
                    : <span className="text-xs text-amber-600">redeploy pending</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{d.version ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">
                  <div className="text-gray-700">{chainName(d.chain_id)}</div>
                  <div className="text-xs text-gray-400">{d.chain_id}</div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{d.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
