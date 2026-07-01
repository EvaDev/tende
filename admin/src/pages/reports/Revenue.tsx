import { Section, Table, useReport, ReportState } from './_shared';

interface Revenue { currency: string; platformCut: string; harvests: number }
interface ConvFee { feeCurrency: string; conversions: number; totalFee: string; totalConverted: string }

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
          <Table
            head={['Fee currency', 'Conversions', 'Total converted', 'Total fees']}
            rows={fees.data.map(r => [
              r.feeCurrency,
              r.conversions.toLocaleString(),
              `R${Number(r.totalConverted).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
              `R${Number(r.totalFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
            ])}
          />
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
          <Table
            head={['Currency', 'Platform cut (minor units)', 'Harvests']}
            rows={data.map(r => [r.currency, r.platformCut, r.harvests.toLocaleString()])}
          />
        )}
      </Section>
    </div>
  );
}
