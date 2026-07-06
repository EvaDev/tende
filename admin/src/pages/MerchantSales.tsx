import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { SortableTable, type Col } from '@/components/SortableTable';
import { apiFetch } from '@/lib/api';
import { shortAddr } from '@/lib/utils';
import { useRole } from '@/hooks/useRole';

interface LineItem { name: string; qty: number; unitPrice: number; lineTotal: number }
interface Sale {
  sale_id: number;
  amount: string;
  currency: string;
  store_number: string | null;
  till_number: string | null;
  latitude: string | null;
  longitude: string | null;
  items: LineItem[] | null;
  consumer_tag: string | null;
  consumer_wallet: string | null;
  tx_hash: string | null;
  status: string;
  created_at: string;
}
interface StoreTill {
  store_number: string;
  till_number: string;
  currency: string;
  sales: number;
  total: string;
  last_sale: string;
}
interface SalesData { sales: Sale[]; byStoreTill: StoreTill[] }

const sym = (c: string) => (c === 'USDC' || c === 'USD' ? '$' : 'R');
const money = (v: string | number, c: string) =>
  `${sym(c)}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const itemsSummary = (items: LineItem[] | null) =>
  items && items.length ? items.map(i => `${i.qty}× ${i.name}`).join(', ') : '—';

const storeTillCols: Col<StoreTill>[] = [
  { key: 'store', header: 'Store', sort: r => r.store_number, render: r => r.store_number },
  { key: 'till',  header: 'Till',  sort: r => r.till_number,  render: r => r.till_number },
  { key: 'sales', header: 'Sales', sort: r => r.sales, render: r => r.sales.toLocaleString() },
  { key: 'total', header: 'Total', sort: r => Number(r.total),
    render: r => <span className="font-semibold text-brand-accent tabular-nums">{money(r.total, r.currency)}</span> },
  { key: 'last',  header: 'Last sale', sort: r => r.last_sale, render: r => new Date(r.last_sale).toLocaleString() },
];

const saleCols: Col<Sale>[] = [
  { key: 'when', header: 'When', sort: s => s.created_at, render: s => new Date(s.created_at).toLocaleString() },
  { key: 'store', header: 'Store', sort: s => s.store_number ?? '', render: s => s.store_number ?? 'Head office' },
  { key: 'till',  header: 'Till',  sort: s => s.till_number ?? '',  render: s => s.till_number ?? 'Web Sale' },
  { key: 'items', header: 'Items', search: s => itemsSummary(s.items),
    render: s => <span className="text-xs">{itemsSummary(s.items)}</span> },
  { key: 'amount', header: 'Amount', sort: s => Number(s.amount),
    render: s => <span className="font-semibold tabular-nums">{money(s.amount, s.currency)}</span>, className: 'text-right' },
  { key: 'customer', header: 'Customer', search: s => `${s.consumer_tag ?? ''} ${s.consumer_wallet ?? ''}`,
    render: s => s.consumer_tag ? `@${s.consumer_tag}` : <span className="font-mono text-[11px]">{shortAddr(s.consumer_wallet ?? '')}</span> },
  { key: 'loc', header: 'Location', sort: s => (s.latitude ? 1 : 0),
    render: s => s.latitude && s.longitude
      ? <a href={`https://maps.google.com/?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer" className="text-brand-accent underline text-xs">map</a>
      : <span className="text-gray-400">—</span> },
  { key: 'tx', header: 'Tx', render: s => s.tx_hash
      ? <a href={`https://sepolia.etherscan.io/tx/${s.tx_hash}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline hover:text-brand-accent">{shortAddr(s.tx_hash)}</a>
      : <span className="text-gray-400">—</span> },
];

export default function MerchantSales() {
  const { role, resolved } = useRole();
  const [data, setData] = useState<SalesData | null>(null);

  useEffect(() => {
    if (role === 'merchant') apiFetch<SalesData>('/api/merchants/me/sales').then(setData).catch(() => {});
  }, [role]);

  if (resolved && role !== 'merchant') {
    return <p className="text-sm text-white/90">Sales are for merchant accounts. Connect your merchant wallet to see your sales.</p>;
  }

  const total = data?.sales.reduce((s, x) => s + Number(x.amount), 0) ?? 0;
  const cur   = data?.sales[0]?.currency ?? 'ZAR';

  return (
    <div className="space-y-4 max-w-5xl">
      <h2 className="text-xl font-semibold text-white">Sales</h2>

      {data && data.sales.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="bg-brand-accent text-white rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-white/70">Total sales</p>
            <p className="text-2xl font-bold mt-1">{money(total, cur)}</p>
          </div>
          <div className="bg-brand-accent text-white rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-white/70">Transactions</p>
            <p className="text-2xl font-bold mt-1">{data.sales.length.toLocaleString()}</p>
          </div>
          <div className="bg-brand-accent text-white rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-white/70">Tills active</p>
            <p className="text-2xl font-bold mt-1">{data.byStoreTill.length}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>By store &amp; till</CardTitle></CardHeader>
        {data && data.byStoreTill.length > 0
          ? <SortableTable cols={storeTillCols} rows={data.byStoreTill} initialSort={{ key: 'total', dir: 'desc' }} />
          : <p className="text-sm text-gray-500 px-1 pb-2">No sales yet.</p>}
      </Card>

      <Card className="p-0 overflow-hidden">
        <SortableTable
          cols={saleCols}
          rows={data?.sales ?? []}
          initialSort={{ key: 'when', dir: 'desc' }}
          searchable
          searchPlaceholder="Search items or customer…"
        />
      </Card>
    </div>
  );
}
