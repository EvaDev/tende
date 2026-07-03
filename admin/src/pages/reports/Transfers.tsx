import { Section, useReport, ReportState, shortHash, shortAddr } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface Transfer {
  block_number: string;
  block_time: string | null;
  tx_hash: string;
  from: string;
  to: string;
  amount: string;       // minor units
  currency: string;     // decoded symbol (or hash if unknown)
}

const cols: Col<Transfer>[] = [
  { key: 'block', header: 'Block', sort: t => Number(t.block_number), render: t => t.block_number },
  { key: 'from', header: 'From', search: t => t.from,
    render: t => <span className="font-mono text-[11px]">{shortAddr(t.from)}</span> },
  { key: 'to', header: 'To', search: t => t.to,
    render: t => <span className="font-mono text-[11px]">{shortAddr(t.to)}</span> },
  { key: 'amount', header: 'Amount', sort: t => Number(t.amount), render: t => t.amount, className: 'tabular-nums' },
  { key: 'currency', header: 'Currency', sort: t => t.currency, search: t => t.currency, render: t => t.currency },
  { key: 'tx', header: 'Tx', render: t => <span className="font-mono text-[11px]">{shortHash(t.tx_hash)}</span> },
];

export default function Transfers() {
  const { data, loading, error } = useReport<Transfer[]>('/api/admin/reports/transfers');

  return (
    <Section title="Value transfers">
      <p className="text-sm text-gray-600">
        Ledger transfers (<code>Vault.Transferred</code>) — the money-movement / Travel-Rule feed.
        Amounts are in minor units; identities are joined off-chain where available.
      </p>
      <ReportState loading={loading} error={error} empty={!loading && !error && data?.length === 0} />
      {data && data.length > 0 && (
        <SortableTable cols={cols} rows={data} initialSort={{ key: 'block', dir: 'desc' }} searchable searchPlaceholder="Search address…" />
      )}
    </Section>
  );
}
