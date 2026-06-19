import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { fmt, statusColor } from '@/lib/utils';
import IconPicker from '@/components/IconPicker';

interface Product {
  id: string;
  merchant_id: string;
  merchant_name?: string;
  name: string;
  send_currency: string;
  receive_currency: string;
  min_amount: number;
  max_amount: number;
  fee_bps: number;
  icon_id: number | null;
  status: string;
}

interface Merchant { id: string; name: string }

const EMPTY = { merchant_id: '', name: '', send_currency: 'ZAR', receive_currency: 'USDC', min_amount: '', max_amount: '', fee_bps: '50', icon_id: null as number | null };

export default function Products() {
  const [rows, setRows] = useState<Product[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    apiFetch<Product[]>('/api/admin/products').then(setRows).catch(() => {});
    apiFetch<Merchant[]>('/api/admin/merchants').then(setMerchants).catch(() => {});
  }
  useEffect(load, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await apiFetch('/api/admin/products', { method: 'POST', body: JSON.stringify(form) });
      setForm(EMPTY); setAdding(false); load();
    } catch (err: any) { setError(err.message ?? 'Failed'); } finally { setSaving(false); }
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(v => ({ ...v, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Products</h2>
        <Button size="sm" onClick={() => setAdding(v => !v)}>{adding ? 'Cancel' : '+ Add Product'}</Button>
      </div>

      {adding && (
        <Card>
          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
            <div><Label>Merchant</Label>
              <Select value={form.merchant_id} onChange={f('merchant_id')} required>
                <option value="">Select…</option>
                {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div><Label>Product Name</Label><Input value={form.name} onChange={f('name')} required /></div>
            <div><Label>Send Currency</Label><Input value={form.send_currency} onChange={f('send_currency')} /></div>
            <div><Label>Receive Currency</Label><Input value={form.receive_currency} onChange={f('receive_currency')} /></div>
            <div><Label>Min Amount (cents)</Label><Input type="number" value={form.min_amount} onChange={f('min_amount')} /></div>
            <div><Label>Max Amount (cents)</Label><Input type="number" value={form.max_amount} onChange={f('max_amount')} /></div>
            <div><Label>Fee (bps)</Label><Input type="number" value={form.fee_bps} onChange={f('fee_bps')} /></div>
            <div>
              <Label>Icon</Label>
              <IconPicker value={form.icon_id} onChange={(id) => setForm(v => ({ ...v, icon_id: id }))} />
            </div>
            {error && <p className="col-span-3 text-red-600 text-sm">{error}</p>}
            <div className="col-span-3"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Product'}</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['','Merchant','Product','Send','Receive','Min','Max','Fee','Status'].map(h =>
              <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">No products yet</td></tr>}
            {rows.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 w-10">
                  {p.icon_id
                    ? <img src={`/api/admin/icons/${p.icon_id}/image`} alt="" className="w-7 h-7 object-contain" />
                    : <div className="w-7 h-7 rounded border border-dashed border-gray-200" />
                  }
                </td>
                <td className="px-4 py-3">{p.merchant_name ?? p.merchant_id}</td>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">{p.send_currency}</td>
                <td className="px-4 py-3">{p.receive_currency}</td>
                <td className="px-4 py-3">{fmt(p.min_amount)}</td>
                <td className="px-4 py-3">{fmt(p.max_amount)}</td>
                <td className="px-4 py-3">{p.fee_bps / 100}%</td>
                <td className="px-4 py-3"><Badge className={statusColor(p.status)}>{p.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
