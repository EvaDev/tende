import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SortableTable, type Col } from '@/components/SortableTable';
import { apiFetch } from '@/lib/api';
import { shortAddr } from '@/lib/utils';

interface Consumer {
  id: string;
  wallet_address: string;
  safe_address?: string;
  kyc_level: number | string;
  kyc_level_name?: string;
  ens_subdomain?: string;
  idos_profile: boolean;
  created_at: string;
}

const cols: Col<Consumer>[] = [
  { key: 'tag', header: 'Tag',
    sort: c => c.ens_subdomain ?? '', search: c => c.ens_subdomain ?? '',
    render: c => <span className="font-medium">{c.ens_subdomain ? `@${c.ens_subdomain}` : '—'}</span> },
  { key: 'wallet', header: 'Wallet',
    search: c => c.wallet_address,
    render: c => <span className="font-mono text-xs">{shortAddr(c.wallet_address)}</span> },
  { key: 'safe', header: 'Safe',
    render: c => <span className="font-mono text-xs">{c.safe_address ? shortAddr(c.safe_address) : '—'}</span> },
  { key: 'kyc', header: 'KYC Level', sort: c => Number(c.kyc_level),
    render: c => <Badge className="bg-brand-accent/10 text-brand-accent">{c.kyc_level_name ?? `Level ${c.kyc_level}`}</Badge> },
  { key: 'idos', header: 'idOS', sort: c => (c.idos_profile ? 1 : 0),
    render: c => (
      <Badge className={c.idos_profile ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}>
        {c.idos_profile ? 'Active' : 'None'}
      </Badge>
    ) },
  { key: 'joined', header: 'Joined', sort: c => c.created_at,
    render: c => <span className="text-gray-400">{new Date(c.created_at).toLocaleDateString()}</span> },
];

export default function Consumers() {
  const [rows, setRows] = useState<Consumer[]>([]);

  useEffect(() => {
    apiFetch<Consumer[]>('/api/admin/consumers').then(setRows).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-brand-accent">Consumers</h2>

      <Card className="p-0 overflow-hidden">
        <SortableTable
          cols={cols}
          rows={rows}
          initialSort={{ key: 'joined', dir: 'desc' }}
          searchable
          searchPlaceholder="Search tag or wallet…"
        />
      </Card>
    </div>
  );
}
