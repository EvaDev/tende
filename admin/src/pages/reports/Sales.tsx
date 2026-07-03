import { Section, useReport, ReportState } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface MerchantSalesRow {
  merchant_id: string;
  name: string;
  sales: number;
  total: string;
  customers: number;
  tills: number;
  last_sale: string | null;
  currency: string | null;
}

const sym = (c: string | null) => (c === 'USDC' || c === 'USD' ? '$' : 'R');
const money = (v: string, c: string | null) =>
  `${sym(c)}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const cols: Col<MerchantSalesRow>[] = [
  { key: 'name', header: 'Merchant', sort: r => r.name.toLowerCase(), search: r => r.name,
    render: r => <span className="font-medium">{r.name}</span> },
  { key: 'sales', header: 'Sales', sort: r => r.sales, render: r => r.sales.toLocaleString() },
  { key: 'customers', header: 'Customers', sort: r => r.customers, render: r => r.customers.toLocaleString() },
  { key: 'tills', header: 'Tills', sort: r => r.tills, render: r => r.tills.toLocaleString() },
  { key: 'total', header: 'Total sales', sort: r => Number(r.total),
    render: r => <span className="font-semibold text-brand-accent tabular-nums">{money(r.total, r.currency)}</span> },
  { key: 'last', header: 'Last sale', sort: r => r.last_sale ?? '',
    render: r => (r.last_sale ? new Date(r.last_sale).toLocaleString() : '—') },
];

export default function Sales() {
  const { data, loading, error } = useReport<MerchantSalesRow[]>('/api/admin/reports/sales');

  return (
    <Section title="Sales by merchant">
      <p className="text-sm text-gray-600">
        POS sales aggregated from the <code>merchant_sales</code> ledger — one line per merchant.
        Each merchant's own line-by-line ledger lives in their Sales page.
      </p>
      <ReportState loading={loading} error={error} empty={!loading && !error && data?.length === 0} />
      {data && data.length > 0 && (
        <SortableTable cols={cols} rows={data} initialSort={{ key: 'total', dir: 'desc' }} searchable searchPlaceholder="Search merchant…" />
      )}
    </Section>
  );
}
