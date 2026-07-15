import { Section, Table, useReport, ReportState, shortAddr } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface RegData {
  total: number;
  completed: number;
  failed: number;
  started: number;
  notCompleted: number;
  byFailedStep: { failed_step: string | null; n: number }[];
  recentFailures: {
    attempt_id: string;
    status: 'failed' | 'started';
    current_step: string | null;
    failed_step: string | null;
    error: string | null;
    ens_subdomain: string | null;
    country_code: string | null;
    wallet_address: string | null;
    created_at: string;
  }[];
}

// Human labels for the pipeline steps recorded by the registration service.
const STEP_LABEL: Record<string, string> = {
  signer:  'Resolve passkey signer',
  deploy:  'Deploy wallet on-chain',
  idos:    'idOS profile / credential',
  ens:     'GNS subdomain',
  pimlico: 'Paymaster whitelist',
  db:      'Write consumer record',
};
const stepLabel = (s: string | null | undefined) => (s ? STEP_LABEL[s] ?? s : 'Unknown / pre-tracking');

type Failure = RegData['recentFailures'][number];
const failureCols: Col<Failure>[] = [
  { key: 'when', header: 'When', sort: r => r.created_at, render: r => new Date(r.created_at).toLocaleString() },
  {
    key: 'status', header: 'Status', sort: r => r.status,
    render: r => (
      <span className={`text-xs font-medium ${r.status === 'failed' ? 'text-brand-danger' : 'text-amber-700'}`}>
        {r.status === 'failed' ? 'Failed' : 'Incomplete'}
      </span>
    ),
  },
  { key: 'tag', header: 'Tag', sort: r => r.ens_subdomain ?? '', search: r => r.ens_subdomain ?? '',
    render: r => (r.ens_subdomain ? `@${r.ens_subdomain}` : '—') },
  { key: 'country', header: 'Country', sort: r => r.country_code ?? '', render: r => r.country_code ?? '—' },
  {
    key: 'step', header: 'Last / failed step',
    sort: r => stepLabel(r.failed_step ?? r.current_step),
    render: r => stepLabel(r.failed_step ?? r.current_step),
  },
  { key: 'error', header: 'Error', search: r => r.error ?? '',
    render: r => (
      <span className="text-xs text-brand-danger break-words">
        {r.error
          ?? (r.status === 'started'
            ? 'Never marked finished (interrupted before funnel close)'
            : '—')}
      </span>
    ) },
  { key: 'wallet', header: 'Wallet', search: r => r.wallet_address ?? '',
    render: r => <span className="font-mono text-xs">{shortAddr(r.wallet_address)}</span> },
];

export default function Registrations() {
  const { data, loading, error } = useReport<RegData>('/api/admin/reports/registrations');
  const pct = data && data.total ? Math.round((data.completed / data.total) * 100) : 0;

  const tiles = data ? [
    { label: 'Total attempts', value: data.total.toLocaleString() },
    { label: 'Completed',      value: data.completed.toLocaleString() },
    { label: 'Not completed',  value: (data.notCompleted ?? data.failed + data.started).toLocaleString() },
    { label: 'Success rate',   value: `${pct}%` },
  ] : [];

  return (
    <Section title="Sign-up funnel">
      <ReportState loading={loading} error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {tiles.map(t => (
              <div key={t.label} className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-400">{t.label}</p>
                <p className="text-xl font-bold text-brand-accent mt-1">{t.value}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            Success rate = completed ÷ all attempts.
            Not completed = {data.failed.toLocaleString()} failed
            {data.started > 0
              ? ` + ${data.started.toLocaleString()} incomplete (interrupted before funnel close)`
              : ''}.
          </p>

          <h4 className="text-sm font-semibold text-gray-900 pt-2">Not completed by step</h4>
          {data.byFailedStep.length > 0 ? (
            <Table
              head={['Step', 'Count']}
              rows={data.byFailedStep.map(r => [stepLabel(r.failed_step), r.n.toLocaleString()])}
            />
          ) : <ReportState loading={false} error={null} empty />}

          <h4 className="text-sm font-semibold text-gray-900 pt-2">Recent not completed</h4>
          {data.recentFailures.length > 0 ? (
            <SortableTable cols={failureCols} rows={data.recentFailures} initialSort={{ key: 'when', dir: 'desc' }} searchable searchPlaceholder="Search tag, wallet or error…" />
          ) : <ReportState loading={false} error={null} empty />}
        </>
      )}
    </Section>
  );
}
