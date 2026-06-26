import { useState } from 'react';
import { Section, Table, useReport, ReportState, shortHash } from './_shared';

interface ChainEvent {
  block_number: string;
  block_time: string | null;
  contract: string;
  event_name: string;
  tx_hash: string;
  log_index: number;
  args: Record<string, unknown>;
}
interface EventsData { count: number; limit: number; offset: number; events: ChainEvent[] }

export default function Events() {
  const [contract, setContract] = useState('');
  const [event, setEvent]       = useState('');
  const qs = new URLSearchParams({ limit: '100' });
  if (contract) qs.set('contract', contract);
  if (event)    qs.set('event', event);

  const { data, loading, error } = useReport<EventsData>(`/api/admin/reports/events?${qs.toString()}`);

  return (
    <Section title="Event feed">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Contract</span>
          <select value={contract} onChange={e => setContract(e.target.value)}
            className="h-8 px-2 text-sm rounded border border-gray-300">
            <option value="">All</option>
            <option value="Vault">Vault</option>
            <option value="TreasuryToken">TreasuryToken</option>
            <option value="Consumer">Consumer</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Event name</span>
          <input value={event} onChange={e => setEvent(e.target.value)} placeholder="e.g. Transferred"
            className="h-8 px-2 text-sm rounded border border-gray-300" />
        </label>
      </div>

      <ReportState loading={loading} error={error} empty={!loading && !error && data?.events.length === 0} />
      {data && data.events.length > 0 && (
        <Table
          head={['Block', 'Contract', 'Event', 'Args', 'Tx']}
          rows={data.events.map(e => [
            e.block_number,
            e.contract,
            <span className="font-medium">{e.event_name}</span>,
            <code className="text-[11px] break-all text-gray-600">{JSON.stringify(e.args)}</code>,
            <span className="font-mono text-[11px]">{shortHash(e.tx_hash)}</span>,
          ])}
        />
      )}
    </Section>
  );
}
