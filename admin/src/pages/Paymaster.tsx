import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

interface PaymasterInfo {
  mode: string;
  policy_id?: string;
  balance_eth?: string;
  sponsored_ops?: number;
}

export default function Paymaster() {
  const [info, setInfo] = useState<PaymasterInfo | null>(null);

  useEffect(() => {
    apiFetch<PaymasterInfo>('/api/admin/paymaster').then(setInfo).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-brand-accent">Paymaster</h2>
      <Card>
        <CardHeader>
          <CardTitle>Pimlico Paymaster</CardTitle>
          <Badge className={info?.mode === 'live' ? 'bg-brand-accent/10 text-brand-accent' : 'bg-brand-accent/10 text-brand-accent'}>
            {info?.mode ?? 'loading'}
          </Badge>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-gray-400 text-xs uppercase">Policy ID</dt><dd className="font-mono">{info?.policy_id ?? '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs uppercase">Balance</dt><dd>{info?.balance_eth ? `${info.balance_eth} ETH` : '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs uppercase">Ops Sponsored</dt><dd>{info?.sponsored_ops ?? '—'}</dd></div>
        </dl>
        {info?.mode === 'stub' && (
          <p className="mt-4 text-xs text-brand-accent bg-brand-accent/10 rounded p-3">
            Paymaster is in stub mode — user ops are not sponsored on-chain. Configure a Pimlico policy ID to activate.
          </p>
        )}
      </Card>
    </div>
  );
}
