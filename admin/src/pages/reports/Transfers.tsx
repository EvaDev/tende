import { Section, Table, useReport, ReportState, shortHash, shortAddr } from './_shared';

interface Transfer {
  block_number: string;
  block_time: string | null;
  tx_hash: string;
  from: string;
  to: string;
  amount: string;       // minor units
  currency: string;     // decoded symbol (or hash if unknown)
}

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
        <Table
          head={['Block', 'From', 'To', 'Amount', 'Currency', 'Tx']}
          rows={data.map(t => [
            t.block_number,
            <span className="font-mono text-[11px]">{shortAddr(t.from)}</span>,
            <span className="font-mono text-[11px]">{shortAddr(t.to)}</span>,
            t.amount,
            t.currency,
            <span className="font-mono text-[11px]">{shortHash(t.tx_hash)}</span>,
          ])}
        />
      )}
    </Section>
  );
}
