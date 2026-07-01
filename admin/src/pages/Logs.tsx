import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface LogEntry { ts: string; level: string; source?: string; msg: string }

// On the dark console: neutral grays/white for info/warn, brand-danger for error.
const LEVEL_COLOR: Record<string, string> = {
  info:  'text-gray-300',
  warn:  'text-white',
  error: 'text-brand-danger',
};

// Source chips — neutral on the dark console; the chip text names the source.
const SOURCE_COLOR: Record<string, string> = {
  server:   'bg-white/10 text-white/70',
  admin:    'bg-white/10 text-white/70',
  consumer: 'bg-white/10 text-white/70',
  client:   'bg-white/10 text-white/70',
};

export default function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const es = new EventSource('/api/admin/logs');
    es.onmessage = (e) => {
      if (paused) return;
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        // Prepend so newest is at top; keep last 1000
        setEntries(prev => [entry, ...prev].slice(0, 1000));
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [paused]);

  const visible = filter
    ? entries.filter(e => {
        const q = filter.toLowerCase();
        return e.msg.toLowerCase().includes(q) || e.level.includes(q) || (e.source ?? '').includes(q);
      })
    : entries;

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Logs</h2>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-8 px-3 text-sm rounded border border-gray-300 focus:outline-none focus:ring-1 focus:ring-brand-accent/50"
          />
          <button
            onClick={() => setPaused(v => !v)}
            className={cn(
              'px-3 py-1.5 text-xs rounded font-medium',
              paused ? 'bg-brand-accent text-white' : 'bg-gray-200 text-gray-700',
            )}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => setEntries([])}
            className="px-3 py-1.5 text-xs rounded font-medium bg-gray-200 text-gray-700"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 bg-gray-950 rounded-xl overflow-y-auto font-mono text-xs leading-5 p-4 min-h-0" style={{ height: 'calc(100vh - 160px)' }}>
        {visible.length === 0 && (
          <p className="text-gray-600 italic">Waiting for log entries…</p>
        )}
        {visible.map((e, i) => (
          <div key={i} className="flex gap-3 hover:bg-white/5 px-1 rounded">
            <span className="text-gray-600 flex-shrink-0">{e.ts.slice(11, 23)}</span>
            <span className={cn('flex-shrink-0 px-1.5 rounded text-[10px] leading-5 uppercase', SOURCE_COLOR[e.source ?? 'server'] ?? SOURCE_COLOR.client)}>
              {e.source ?? 'server'}
            </span>
            <span className={cn('flex-shrink-0 w-10', LEVEL_COLOR[e.level] ?? 'text-gray-400')}>{e.level}</span>
            <span className="text-gray-200 break-all">{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
