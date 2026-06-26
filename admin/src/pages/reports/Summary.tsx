import { Section, Table, useReport, ReportState } from './_shared';

interface SummaryData {
  totalEvents: number;
  blockRange: [string | null, string | null];
  cursor: { last_block: string; updated_at: string } | null;
  byType: { contract: string; event_name: string; n: number }[];
}

export default function Summary() {
  const { data, loading, error } = useReport<SummaryData>('/api/admin/reports/summary');

  const tiles = data ? [
    { label: 'Indexed events', value: data.totalEvents.toLocaleString() },
    { label: 'Block range', value: data.blockRange[0] ? `${data.blockRange[0]} – ${data.blockRange[1]}` : '—' },
    { label: 'Indexer cursor', value: data.cursor ? `#${data.cursor.last_block}` : 'not started' },
  ] : [];

  return (
    <Section title="Indexer summary">
      <ReportState loading={loading} error={error} />
      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {tiles.map(t => (
              <div key={t.label} className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">{t.label}</p>
                <p className="text-xl font-bold text-brand-accent mt-1 break-all">{t.value}</p>
              </div>
            ))}
          </div>
          {data.cursor && (
            <p className="text-xs text-gray-500">Cursor last updated {new Date(data.cursor.updated_at).toLocaleString()}.</p>
          )}
          {data.byType.length > 0 ? (
            <Table
              head={['Contract', 'Event', 'Count']}
              rows={data.byType.map(r => [r.contract, r.event_name, r.n.toLocaleString()])}
            />
          ) : <ReportState loading={false} error={null} empty />}
        </>
      )}
    </Section>
  );
}
