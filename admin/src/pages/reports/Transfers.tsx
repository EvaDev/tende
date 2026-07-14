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

interface Withdrawal {
  id: string;
  from_wallet: string;
  to_address: string;
  fromLabel: string;
  toLabel: string;
  grossDisplay: string;
  feeDisplay: string;
  netDisplay: string;
  fee_bps: number;
  status: string;
  withdraw_tx: string | null;
  recipient_name: string | null;
  recipient_id_number: string | null;
  recipient_phone: string | null;
  recipient_country: string | null;
  recipient_relationship: string | null;
  created_at: string;
  executed_at: string | null;
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

const wCols: Col<Withdrawal>[] = [
  { key: 'time', header: 'Time', sort: w => w.created_at,
    render: w => new Date(w.created_at).toLocaleString() },
  { key: 'from', header: 'Originator', search: w => `${w.fromLabel} ${w.from_wallet}`,
    render: w => partyCell(w.from_wallet, w.fromLabel) },
  { key: 'to', header: 'Beneficiary', search: w => `${w.toLabel} ${w.to_address} ${w.recipient_name ?? ''}`,
    render: w => (
      <div className="space-y-0.5">
        <div className="text-sm text-gray-900">{w.recipient_name ?? '—'}</div>
        <div>{partyCell(w.to_address, shortAddr(w.to_address))}</div>
      </div>
    ) },
  { key: 'id', header: 'ID / Phone', search: w => `${w.recipient_id_number ?? ''} ${w.recipient_phone ?? ''}`,
    render: w => (
      <span className="text-xs text-gray-600">
        {[w.recipient_id_number, w.recipient_phone].filter(Boolean).join(' · ') || '—'}
      </span>
    ) },
  { key: 'country', header: 'Country', sort: w => w.recipient_country ?? '',
    render: w => w.recipient_country ?? '—' },
  { key: 'rel', header: 'Relationship', search: w => w.recipient_relationship ?? '',
    render: w => (w.recipient_relationship ?? '—').replace(/_/g, ' ') },
  { key: 'net', header: 'Net USDC', sort: w => Number(w.netDisplay),
    render: w => `$${w.netDisplay}`, className: 'tabular-nums' },
  { key: 'fee', header: 'Fee', sort: w => Number(w.feeDisplay),
    render: w => `$${w.feeDisplay}`, className: 'tabular-nums' },
  { key: 'status', header: 'Status', sort: w => w.status, render: w => w.status },
  { key: 'tx', header: 'Tx', render: w => w.withdraw_tx
    ? <span className="font-mono text-[11px]">{shortHash(w.withdraw_tx)}</span>
    : '—' },
];

export default function Transfers() {
  const { data, loading, error } = useReport<Transfer[]>('/api/admin/reports/transfers');
  const withdrawals = useReport<Withdrawal[]>('/api/admin/reports/withdrawals');

  return (
    <>
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

      <Section title="External USDC withdrawals (Travel Rule)">
        <p className="text-sm text-gray-600">
          Consumer withdrawals to unknown <code>0x</code> wallets. Beneficiary details are declared by the
          sender at send time and stored against the transaction for Travel Rule compliance.
        </p>
        <ReportState
          loading={withdrawals.loading}
          error={withdrawals.error}
          empty={!withdrawals.loading && !withdrawals.error && withdrawals.data?.length === 0}
        />
        {withdrawals.data && withdrawals.data.length > 0 && (
          <SortableTable
            cols={wCols}
            rows={withdrawals.data}
            initialSort={{ key: 'time', dir: 'desc' }}
            searchable
            searchPlaceholder="Search beneficiary…"
          />
        )}
      </Section>
    </>
  );
}
