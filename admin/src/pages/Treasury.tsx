import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { fmt } from '@/lib/utils';

interface TreasuryInfo {
  ttza_balance: string;
  ttzw_balance: string;
  vault_usdc: string;
  ttza_address: string;
  ttzw_address: string;
  vault_address: string;
}

export default function Treasury() {
  const [info, setInfo] = useState<TreasuryInfo | null>(null);

  useEffect(() => {
    apiFetch<TreasuryInfo>('/api/admin/treasury').then(setInfo).catch(() => {});
  }, []);

  const tiles = info
    ? [
        { label: 'TTZA Supply', value: `${(Number(info.ttza_balance) / 100).toLocaleString()} TTZA`, addr: info.ttza_address },
        { label: 'TTZW Supply', value: `${(Number(info.ttzw_balance) / 100).toLocaleString()} TTZW`, addr: info.ttzw_address },
        { label: 'Vault USDC',  value: `${(Number(info.vault_usdc) / 1e6).toLocaleString()} USDC`, addr: info.vault_address },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-brand-accent">Treasury</h2>
      {!info && <p className="text-gray-400 text-sm">Loading…</p>}
      <div className="grid grid-cols-3 gap-4">
        {tiles.map(({ label, value, addr }) => (
          <Card key={label}>
            <CardHeader><CardTitle className="text-xs uppercase tracking-wide text-gray-400">{label}</CardTitle></CardHeader>
            <p className="text-2xl font-bold text-brand-accent">{value}</p>
            <p className="font-mono text-xs text-gray-400 mt-2 break-all">{addr}</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
        <p className="text-sm text-gray-500">Mint and burn functions require the deployer admin wallet. Use the Foundry scripts or a Safe transaction to execute treasury operations.</p>
      </Card>
    </div>
  );
}
