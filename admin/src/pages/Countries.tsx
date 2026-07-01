import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useRole } from '@/hooks/useRole';

interface Country {
  code: string;
  name: string;
  send_enabled: boolean;
  receive_enabled: boolean;
}

const EMPTY = { code: '', name: '', send_enabled: true, receive_enabled: true };

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
      await apiFetch('/api/admin/countries', { method: 'POST', body: JSON.stringify(form) });
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
          <form onSubmit={handleSubmit} className="grid grid-cols-4 gap-4 items-end">
            <div><Label>Code (ISO 2)</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} maxLength={2} required /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.send_enabled} onChange={e => setForm(f => ({ ...f, send_enabled: e.target.checked }))} /> Send enabled</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.receive_enabled} onChange={e => setForm(f => ({ ...f, receive_enabled: e.target.checked }))} /> Receive enabled</label>
            <div className="col-span-4"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Country'}</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['Code','Name','Send','Receive'].map(h =>
              <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No countries configured</td></tr>}
            {rows.map(c => (
              <tr key={c.code} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-bold">{c.code}</td>
                <td className="px-4 py-3">{c.name}</td>
                <td className="px-4 py-3"><Badge className={c.send_enabled ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}>{c.send_enabled ? 'Enabled' : 'Disabled'}</Badge></td>
                <td className="px-4 py-3"><Badge className={c.receive_enabled ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}>{c.receive_enabled ? 'Enabled' : 'Disabled'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
