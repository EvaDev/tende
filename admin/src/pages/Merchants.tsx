import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { statusColor, shortAddr } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { useRole } from '@/hooks/useRole';
import { ConnectPrompt } from '@/components/ConnectPrompt';

interface Merchant {
  id: string;
  name: string;
  wallet_address: string;
  status: string;
  country_code: string;
  currency_code: string;
  icon_id: number | null;
  created_at: string;
}

interface Country { code: string; name: string }
interface MerchantForm { name: string; wallet_address: string; country_code: string }
const EMPTY: MerchantForm = { name: '', wallet_address: '', country_code: '' };

// Admin only controls a merchant's trading status. The merchant's own details
// (name, logo, icon, contact) are edited by the merchant on their connected
// wallet via "My Business" (PATCH /api/merchants/me) — never by the admin.
const STATUSES = [
  { value: 'PENDING',  label: 'Pending' },
  { value: 'ACTIVE',   label: 'Active (trading)' },
  { value: 'INACTIVE', label: 'Inactive' },
];

export default function Merchants() {
  const { isConnected } = useAccount();
  const { isAdmin } = useRole();
  const [rows, setRows]           = useState<Merchant[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [form, setForm]           = useState<MerchantForm>(EMPTY);
  const [adding, setAdding]       = useState(false);
  const [saving, setSaving]       = useState(false);
  const [savingId, setSavingId]   = useState<string | null>(null);
  const [error, setError]         = useState('');

  function load() {
    apiFetch<Merchant[]>('/api/admin/merchants').then(setRows).catch(() => {});
    apiFetch<Country[]>('/api/admin/countries').then(setCountries).catch(() => {});
  }
  useEffect(load, []);

  async function updateStatus(id: string, status: string) {
    setSavingId(id); setError('');
    try {
      await apiFetch(`/api/admin/merchants/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setRows(rs => rs.map(m => (m.id === id ? { ...m, status } : m)));
    } catch (err) {
      setError((err as Error).message ?? 'Failed to update status');
    } finally {
      setSavingId(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await apiFetch('/api/admin/merchants', { method: 'POST', body: JSON.stringify(form) });
      setForm(EMPTY); setAdding(false); load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed');
    } finally { setSaving(false); }
  }

  const norm = (s: string) => (STATUSES.some(o => o.value === s.toUpperCase()) ? s.toUpperCase() : 'PENDING');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Merchants</h2>
        {isAdmin && (
          <Button size="sm" onClick={() => setAdding(v => !v)}>
            {adding ? 'Cancel' : '+ Add Merchant'}
          </Button>
        )}
      </div>

      {!isConnected && <ConnectPrompt action="manage merchants" />}
      {error && <p className="text-brand-danger text-sm">{error}</p>}

      {isAdmin && adding && (
        <Card>
          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <Label>Wallet Address</Label>
              <Input value={form.wallet_address} onChange={e => setForm(f => ({ ...f, wallet_address: e.target.value }))} required />
            </div>
            <div>
              <Label>Country</Label>
              <Select value={form.country_code} onChange={e => setForm(f => ({ ...f, country_code: e.target.value }))} required>
                <option value="">Select…</option>
                {countries.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </Select>
            </div>
            <p className="col-span-3 text-xs text-gray-400">
              The merchant sets their own name, logo and icon from their wallet — these are just the starting details.
            </p>
            <div className="col-span-3">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Merchant'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['', 'Name', 'Wallet', 'Country', 'Status', 'Created'].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No merchants yet</td></tr>
            )}
            {rows.map(m => (
              <tr key={m.id} className="border-b hover:bg-gray-50">
                {/* Merchant icon (read-only — set by the merchant) */}
                <td className="px-4 py-3 w-12">
                  {m.icon_id != null
                    ? <img src={`/api/admin/icons/${m.icon_id}/image`} className="w-8 h-8 rounded object-contain" alt="" />
                    : <div className="w-8 h-8 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-300 text-xs">?</div>}
                </td>
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{shortAddr(m.wallet_address)}</td>
                <td className="px-4 py-3">{m.country_code}</td>
                <td className="px-4 py-3">
                  {isAdmin ? (
                    <select
                      value={norm(m.status)}
                      disabled={savingId === m.id}
                      onChange={e => updateStatus(m.id, e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-accent/30 disabled:opacity-50"
                    >
                      {STATUSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <Badge className={statusColor(m.status)}>{m.status}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400">{new Date(m.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
