import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { statusColor, shortAddr } from '@/lib/utils';

interface Consumer {
  id: string;
  wallet_address: string;
  safe_address?: string;
  kyc_level: string;
  idos_profile: boolean;
  created_at: string;
}

export default function Consumers() {
  const [rows, setRows] = useState<Consumer[]>([]);

  useEffect(() => {
    apiFetch<Consumer[]>('/api/admin/consumers').then(setRows).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-brand-accent">Consumers</h2>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['Wallet','Safe','KYC Level','idOS','Joined'].map(h =>
              <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No consumers yet</td></tr>}
            {rows.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{shortAddr(c.wallet_address)}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.safe_address ? shortAddr(c.safe_address) : '—'}</td>
                <td className="px-4 py-3"><Badge className={statusColor(c.kyc_level)}>{c.kyc_level}</Badge></td>
                <td className="px-4 py-3">
                  <Badge className={c.idos_profile ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
                    {c.idos_profile ? 'Active' : 'None'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
