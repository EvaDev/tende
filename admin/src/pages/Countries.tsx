import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { SortableTable, type Col } from '@/components/SortableTable';
import { apiFetch } from '@/lib/api';
import { useRole } from '@/hooks/useRole';
import { flagEmoji } from '@/hooks/useDetectedCountry';

interface Country {
  code: string;
  name: string;
  dial_code: string | null;
  vat_rate_pct: string | number | null;
  currency_code?: string;
  send_enabled: boolean;
  receive_enabled: boolean;
  has_treasury_token?: boolean;
  treasury_token?: string | null;
}

const EMPTY = {
  code: '', name: '', dial_code: '', vat_rate_pct: '',
  send_enabled: true, receive_enabled: true,
};

function fmtVat(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

const cols: Col<Country>[] = [
  { key: 'code', header: 'Code',
    sort: c => c.code, search: c => c.code,
    render: c => (
      <span className="inline-flex items-center gap-2 font-mono font-bold">
        <span className="text-base leading-none" aria-hidden>{flagEmoji(c.code)}</span>
        {c.code}
      </span>
    ) },
  { key: 'name', header: 'Name',
    sort: c => c.name, search: c => c.name,
    render: c => c.name },
  { key: 'dial', header: 'Dial code',
    sort: c => c.dial_code ?? '', search: c => c.dial_code ?? '',
    render: c => <span className="font-mono tabular-nums">{c.dial_code || '—'}</span> },
  { key: 'vat', header: 'VAT rate',
    sort: c => Number(c.vat_rate_pct ?? -1),
    render: c => <span className="tabular-nums">{fmtVat(c.vat_rate_pct)}</span> },
  { key: 'send', header: 'Send', sort: c => (c.send_enabled ? 1 : 0),
    render: c => (
      <div>
        <Badge className={c.send_enabled ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}>
          {c.send_enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        {!c.has_treasury_token && (
          <div className="text-[10px] text-gray-400 mt-0.5">No treasury token</div>
        )}
      </div>
    ) },
  { key: 'receive', header: 'Receive', sort: c => (c.receive_enabled ? 1 : 0),
    render: c => (
      <div>
        <Badge className={c.receive_enabled ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}>
          {c.receive_enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        {c.treasury_token && (
          <div className="text-[10px] text-gray-400 mt-0.5 font-mono">{c.treasury_token}</div>
        )}
      </div>
    ) },
];

export default function Countries() {
  const { isAdmin } = useRole();
  const [rows, setRows] = useState<Country[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() { apiFetch<Country[]>('/api/admin/countries').then(setRows).catch(() => {}); }
  useEffect(load, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try {
      await apiFetch('/api/admin/countries', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          dial_code: form.dial_code || undefined,
          vat_rate_pct: form.vat_rate_pct === '' ? undefined : Number(form.vat_rate_pct),
          send_enabled: form.send_enabled,
          receive_enabled: form.receive_enabled,
        }),
      });
      setForm(EMPTY); setAdding(false); load();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Countries</h2>
        {isAdmin && <Button size="sm" onClick={() => setAdding(v => !v)}>{adding ? 'Cancel' : '+ Add Country'}</Button>}
      </div>

      {isAdmin && adding && (
        <Card>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 sm:grid-cols-3 gap-4 items-end">
            <div><Label>Code (ISO 2)</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} maxLength={2} required /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label>Dial code</Label><Input value={form.dial_code} onChange={e => setForm(f => ({ ...f, dial_code: e.target.value }))} placeholder="+27" /></div>
            <div><Label>VAT rate (%)</Label><Input type="number" step="0.01" min="0" value={form.vat_rate_pct} onChange={e => setForm(f => ({ ...f, vat_rate_pct: e.target.value }))} placeholder="15" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.send_enabled} onChange={e => setForm(f => ({ ...f, send_enabled: e.target.checked }))} /> Send enabled</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.receive_enabled} onChange={e => setForm(f => ({ ...f, receive_enabled: e.target.checked }))} /> Receive enabled</label>
            <div className="col-span-full"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Country'}</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <SortableTable
          cols={cols}
          rows={rows}
          initialSort={{ key: 'name', dir: 'asc' }}
          searchable
          searchPlaceholder="Search code, name or dial…"
        />
      </Card>
    </div>
  );
}
