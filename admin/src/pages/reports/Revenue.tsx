import { Section, Table, useReport, ReportState } from './_shared';

interface Revenue { currency: string; platformCut: string; harvests: number }

export default function Revenue() {
  const { data, loading, error } = useReport<Revenue[]>('/api/admin/reports/revenue');

  return (
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
  );
}
