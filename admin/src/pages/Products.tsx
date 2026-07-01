import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { fmt, statusColor } from '@/lib/utils';
import IconPicker from '@/components/IconPicker';
import { useRole } from '@/hooks/useRole';

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
  const { isAdmin, isMerchant } = useRole();
  // Merchants manage their OWN catalog; admins see/manage the cross-merchant catalog.
  return isMerchant && !isAdmin ? <MerchantProducts /> : <AdminProducts />;
}

function AdminProducts() {
  const { isAdmin } = useRole();
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
        {isAdmin && <Button size="sm" onClick={() => setAdding(v => !v)}>{adding ? 'Cancel' : '+ Add Product'}</Button>}
      </div>

      {isAdmin && adding && (
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
            {error && <p className="col-span-3 text-brand-danger text-sm">{error}</p>}
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
                <td className="px-4 py-3">{Number.isFinite(p.fee_bps) ? `${p.fee_bps / 100}%` : '—'}</td>
                <td className="px-4 py-3"><Badge className={statusColor(p.status)}>{p.status || '—'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Merchant's own product catalog (add / edit) ───────────────────────────────
interface MyProduct { id: string; name: string; price: string; currency_code: string; is_active: boolean }

function MerchantProducts() {
  const [rows, setRows]     = useState<MyProduct[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MyProduct | null>(null);
  const [name, setName]     = useState('');
  const [price, setPrice]   = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function load() { apiFetch<MyProduct[]>('/api/merchants/me/products').then(setRows).catch(() => {}); }
  useEffect(load, []);

  function openAdd()  { setEditing(null); setName(''); setPrice('1'); setError(''); setAdding(true); }
  function openEdit(p: MyProduct) { setEditing(p); setName(p.name); setPrice((Number(p.price) / 100).toString()); setError(''); setAdding(true); }

  async function save() {
    setError('');
    if (!name.trim() || !(Number(price) > 0)) { setError('Enter a name and a positive unit price'); return; }
    setSaving(true);
    try {
      if (editing) await apiFetch(`/api/merchants/me/products/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim(), unitPrice: Number(price) }) });
      else         await apiFetch('/api/merchants/me/products', { method: 'POST', body: JSON.stringify({ name: name.trim(), unitPrice: Number(price) }) });
      setAdding(false); load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function toggleActive(p: MyProduct) {
    await apiFetch(`/api/merchants/me/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !p.is_active }) }).catch(() => {});
    load();
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">My Products</h2>
        <Button size="sm" onClick={openAdd}>+ Add Product</Button>
      </div>
      <p className="text-sm text-white/90 -mt-2">Products you sell on your Point of Sale. For cash-out, add a “Cash out” product at R1 and ring up the amount as the quantity.</p>

      {adding && (
        <Card className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Product name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cash out" /></div>
            <div><Label>Unit price (R)</Label><Input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
          </div>
          {error && <p className="text-brand-danger text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</Button>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['Product', 'Unit price', 'Status', ''].map(h =>
              <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No products yet</td></tr>}
            {rows.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">R{(Number(p.price) / 100).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(p)} className={`text-xs px-2 py-1 rounded-lg ${p.is_active ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}`}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(p)} className="text-xs text-brand-accent hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
