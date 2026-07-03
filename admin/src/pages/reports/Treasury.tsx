import { Section, useReport, ReportState, shortHash, shortAddr } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface TEvent {
  type: string;            // 'Minted' | 'Burned' | 'Asset purchase'
  token: string;
  decimals: number;
  amount: string;          // raw units
  spent?: string;          // for purchases: amount spent
  spentCurrency?: string;
  spentDecimals?: number;
  party: string;
  reference: string | null;
  refKind: string | null;
  refSource: string | null;
  txHash: string;
  blockTime: string | null;
}
interface TreasuryReport { events: TEvent[]; totals: Record<string, string> }

const fmt = (raw: string | undefined, dec: number) =>
  (Number(raw ?? '0') / 10 ** dec).toLocaleString(undefined, { maximumFractionDigits: dec });

const cols: Col<TEvent>[] = [
  { key: 'type', header: 'Type', sort: e => e.type, search: e => e.type, render: e => e.type },
  { key: 'amount', header: 'Amount', sort: e => Number(e.amount) / 10 ** e.decimals,
    render: e => e.type === 'Asset purchase'
      ? <span>+{fmt(e.amount, e.decimals)} {e.token}<span className="text-gray-400"> for {fmt(e.spent, e.spentDecimals ?? 2)} {e.spentCurrency}</span></span>
      : <span className={e.type === 'Burned' ? 'text-brand-danger' : 'text-brand-accent'}>{e.type === 'Burned' ? '−' : '+'}{fmt(e.amount, e.decimals)} {e.token}</span> },
  { key: 'reference', header: 'Reference', search: e => e.reference ?? '',
    render: e => e.reference
      ? <span>{e.reference}<span className="ml-1 text-[10px] uppercase tracking-wide text-gray-400">{e.refSource}/{e.refKind === 'bank_deposit' ? 'bank' : e.refKind}</span></span>
      : <span className="text-gray-400">—</span> },
  { key: 'party', header: 'Counterparty', search: e => e.party,
    render: e => <span className="font-mono text-[11px]">{shortAddr(e.party)}</span> },
  { key: 'tx', header: 'Tx',
    render: e => <a href={`https://sepolia.etherscan.io/tx/${e.txHash}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline hover:text-brand-accent">{shortHash(e.txHash)}</a> },
];

export default function TreasuryReport() {
  const { data, loading, error } = useReport<TreasuryReport>('/api/admin/reports/treasury');

  const minted = Number(data?.totals?.Minted ?? '0') / 100;
  const burned = Number(data?.totals?.Burned ?? '0') / 100;

  return (
    <Section title="Mint &amp; burn / asset purchases">
      <p className="text-sm text-gray-600">
        Treasury-token minting &amp; burning and underlying-asset purchases, each linked to the off-chain
        deposit reference that backs it (a <strong>voucher number</strong> for consumer top-ups, a
        <strong> bank-deposit reference</strong> for admin cash-ins). Amounts shown in token units.
      </p>

      {data && (
        <div className="grid grid-cols-3 gap-4">
          {[
            ['Total minted',     `${minted.toLocaleString()} TTZA`],
            ['Total burned',     `${burned.toLocaleString()} TTZA`],
            ['Net outstanding',  `${(minted - burned).toLocaleString()} TTZA`],
          ].map(([label, value]) => (
            <div key={label} className="bg-brand-card border border-gray-200 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
              <p className="text-xl font-bold text-brand-accent mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}

      <ReportState loading={loading} error={error} empty={!loading && !error && data?.events.length === 0} />

      {data && data.events.length > 0 && (
        <SortableTable cols={cols} rows={data.events} searchable searchPlaceholder="Search reference or counterparty…" />
      )}
    </Section>
  );
}
