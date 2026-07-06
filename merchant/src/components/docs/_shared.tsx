import type { ReactNode } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold text-brand-accent">{title}</h3>
      {children}
    </section>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-brand-accent/5 text-gray-900">
          <tr>
            {head.map(h => <th key={h} className="text-left font-semibold p-3 align-top">{h}</th>)}
          </tr>
        </thead>
        <tbody className="text-gray-700">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-200 align-top">
              {r.map((c, j) => <td key={j} className="p-3">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Code = ({ children }: { children: ReactNode }) =>
  <code className="font-mono text-[0.8em] bg-gray-100 px-1 py-0.5 rounded">{children}</code>;
