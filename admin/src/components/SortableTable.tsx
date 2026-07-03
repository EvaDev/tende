import { useState, useMemo, type ReactNode } from 'react';

// A client-side sortable + text-searchable table for the report views. Columns opt
// into sorting (via `sort`) and free-text search (via `search`) individually. Page-
// level dropdown filters should pre-filter the `rows` array before passing it in.
export interface Col<T> {
  key: string;
  header: string;
  render: (r: T) => ReactNode;
  sort?: (r: T) => string | number;   // sortable when provided
  search?: (r: T) => string;          // included in the search box when provided
  className?: string;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function SortableTable<T>({ cols, rows, initialSort, searchable, searchPlaceholder }: {
  cols: Col<T>[];
  rows: T[];
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const [q, setQ]       = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => cols.some(c => c.search && c.search(r).toLowerCase().includes(needle)));
  }, [rows, q, cols]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = cols.find(c => c.key === sort.key);
    if (!col?.sort) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sort!(a), bv = col.sort!(b);
      if (av < bv) return -dir;
      if (av > bv) return  dir;
      return 0;
    });
  }, [filtered, sort, cols]);

  const toggle = (key: string) => {
    const col = cols.find(c => c.key === key);
    if (!col?.sort) return;
    setSort(s => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  return (
    <div>
      {searchable && (
        <div className="p-3 border-b border-gray-200">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={searchPlaceholder ?? 'Search…'}
            className="w-full sm:w-72 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {cols.map(c => (
                <th
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  className={`text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap ${c.sort ? 'cursor-pointer select-none hover:text-gray-700' : ''} ${c.className ?? ''}`}
                >
                  {c.header}
                  {sort?.key === c.key && <span className="ml-1 text-brand-accent">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {cols.map(c => <td key={c.key} className={`px-4 py-3 align-top ${c.className ?? ''}`}>{c.render(r)}</td>)}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-gray-400">No matching rows</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
