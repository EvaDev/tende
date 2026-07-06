import { Section, useReport, ReportState, shortHash, shortAddr } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface Transfer {
  block_number: string;
  block_time: string | null;
  tx_hash: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  amount: string;
  amountDisplay: string;
  amountValue: number;
  currency: string;
}

const partyCell = (addr: string, label: string) => {
  const display = label.startsWith('0x') ? shortAddr(label) : label;
  return (
    <a
      href={`https://sepolia.etherscan.io/address/${addr}`}
      target="_blank"
      rel="noreferrer"
      title={addr}
      className="font-mono text-[11px] hover:text-brand-accent hover:underline"
    >
      {display}
    </a>
  );
};

const cols: Col<Transfer>[] = [
  { key: 'block', header: 'Block', sort: t => Number(t.block_number), render: t => t.block_number },
  { key: 'time', header: 'Time', sort: t => t.block_time ?? '',
    render: t => (t.block_time ? new Date(t.block_time).toLocaleString() : '—') },
  { key: 'from', header: 'From', search: t => `${t.fromLabel} ${t.from}`,
    render: t => partyCell(t.from, t.fromLabel) },
  { key: 'to', header: 'To', search: t => `${t.toLabel} ${t.to}`,
    render: t => partyCell(t.to, t.toLabel) },
  { key: 'amount', header: 'Amount', sort: t => t.amountValue,
    render: t => t.amountDisplay, className: 'tabular-nums' },
  { key: 'currency', header: 'Currency', sort: t => t.currency, search: t => t.currency, render: t => t.currency },
  { key: 'tx', header: 'Tx', render: t => <span className="font-mono text-[11px]">{shortHash(t.tx_hash)}</span> },
];

export default function Transfers() {
  const { data, loading, error } = useReport<Transfer[]>('/api/admin/reports/transfers');

  return (
    <Section title="Value transfers">
      <p className="text-sm text-gray-600">
        Ledger transfers (<code>Vault.Transferred</code>) — the money-movement / Travel-Rule feed.
        Amounts are shown in major units (e.g. R25.00 for ZAR). Identities are joined off-chain where available.
      </p>
      <ReportState loading={loading} error={error} empty={!loading && !error && data?.length === 0} />
      {data && data.length > 0 && (
        <SortableTable cols={cols} rows={data} initialSort={{ key: 'block', dir: 'desc' }} searchable searchPlaceholder="Search address…" />
      )}
    </Section>
  );
}
