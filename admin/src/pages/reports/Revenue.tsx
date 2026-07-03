import { Section, useReport, ReportState } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface Revenue { currency: string; platformCut: string; harvests: number }
interface ConvFee { feeCurrency: string; conversions: number; totalFee: string; totalConverted: string }

const feeCols: Col<ConvFee>[] = [
  { key: 'currency', header: 'Fee currency', sort: r => r.feeCurrency, render: r => r.feeCurrency },
  { key: 'conversions', header: 'Conversions', sort: r => r.conversions, render: r => r.conversions.toLocaleString() },
  { key: 'converted', header: 'Total converted', sort: r => Number(r.totalConverted),
    render: r => `R${Number(r.totalConverted).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
  { key: 'fees', header: 'Total fees', sort: r => Number(r.totalFee),
    render: r => `R${Number(r.totalFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
];

const revCols: Col<Revenue>[] = [
  { key: 'currency', header: 'Currency', sort: r => r.currency, render: r => r.currency },
  { key: 'cut', header: 'Platform cut (minor units)', sort: r => Number(r.platformCut), render: r => r.platformCut, className: 'tabular-nums' },
  { key: 'harvests', header: 'Harvests', sort: r => r.harvests, render: r => r.harvests.toLocaleString() },
];

export default function Revenue() {
  const { data, loading, error } = useReport<Revenue[]>('/api/admin/reports/revenue');
  const fees = useReport<ConvFee[]>('/api/admin/reports/conversion-fees');

  return (
    <div className="space-y-8">
      <Section title="Conversion fees (FX spread)">
        <p className="text-sm text-gray-600">
          Platform revenue from currency conversions (e.g. ZAR→USD). The consumer is debited the full
          amount and credited the post-spread amount; the spread is retained in the reserve and
          recorded per conversion.
        </p>
        <ReportState loading={fees.loading} error={fees.error} empty={!fees.loading && !fees.error && fees.data?.length === 0} />
        {fees.data && fees.data.length > 0 && (
          <SortableTable cols={feeCols} rows={fees.data} initialSort={{ key: 'fees', dir: 'desc' }} />
        )}
      </Section>

      <Section title="Protocol revenue (vault yield)">
        <p className="text-sm text-gray-600">
          The platform’s share of harvested vault yield (<code>YieldHarvested.platformCut</code>) by
          currency. Consumer balances are flat 1:1 and earn no yield — all of it accrues here.
          Amounts in minor units. (Empty until tradeable backing earns yield and a harvest runs.)
        </p>
        <ReportState loading={loading} error={error} empty={!loading && !error && data?.length === 0} />
        {data && data.length > 0 && (
          <SortableTable cols={revCols} rows={data} initialSort={{ key: 'cut', dir: 'desc' }} />
        )}
      </Section>
    </div>
  );
}
