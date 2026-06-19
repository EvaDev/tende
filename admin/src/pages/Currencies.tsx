import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';

interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  currency_type: string;
  enabled: boolean;
  token_address?: string;
}

interface CurrencyType { type_code: string; label: string; badge_class: string }

const EMPTY = { code: '', name: '', symbol: '', decimals: '2', currency_type: '' };

export default function Currencies() {
  const [rows, setRows] = useState<Currency[]>([]);
  const [types, setTypes] = useState<CurrencyType[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const badgeClass = (code: string) => types.find(t => t.type_code === code)?.badge_class ?? 'bg-gray-100 text-gray-600';

  function load() { apiFetch<Currency[]>('/api/admin/currencies').then(setRows).catch(() => {}); }
  useEffect(() => {
    load();
    apiFetch<CurrencyType[]>('/api/currency-types').then(t => {
      setTypes(t);
      setForm(f => ({ ...f, currency_type: f.currency_type || t[0]?.type_code || '' }));
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await apiFetch('/api/admin/currencies', { method: 'POST', body: JSON.stringify(form) });
      setForm(EMPTY); setAdding(false); load();
    } catch (err: any) { setError(err.message ?? 'Failed'); } finally { setSaving(false); }
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(v => ({ ...v, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Currencies</h2>
        <Button size="sm" onClick={() => setAdding(v => !v)}>{adding ? 'Cancel' : '+ Add Currency'}</Button>
      </div>

      {adding && (
        <Card>
          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
            <div><Label>Code</Label><Input value={form.code} onChange={f('code')} placeholder="e.g. EUR" required /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={f('name')} required /></div>
            <div><Label>Symbol</Label><Input value={form.symbol} onChange={f('symbol')} placeholder="e.g. €" /></div>
            <div><Label>Decimals</Label><Input type="number" value={form.decimals} onChange={f('decimals')} min="0" max="18" /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.currency_type} onChange={f('currency_type')}>
                {types.map(t => <option key={t.type_code} value={t.type_code}>{t.label}</option>)}
              </Select>
            </div>
            {error && <p className="col-span-3 text-red-600 text-sm">{error}</p>}
            <div className="col-span-3"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Currency'}</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['Code','Name','Symbol','Decimals','Type','Token','Status'].map(h =>
              <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No currencies</td></tr>}
            {rows.map(c => (
              <tr key={c.code} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-bold">{c.code}</td>
                <td className="px-4 py-3">{c.name}</td>
                <td className="px-4 py-3">{c.symbol}</td>
                <td className="px-4 py-3">{c.decimals}</td>
                <td className="px-4 py-3"><Badge className={badgeClass(c.currency_type)}>{c.currency_type}</Badge></td>
                <td className="px-4 py-3 font-mono text-xs">{c.token_address ? `${c.token_address.slice(0,10)}…` : '—'}</td>
                <td className="px-4 py-3"><Badge className={c.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>{c.enabled ? 'Active' : 'Inactive'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
