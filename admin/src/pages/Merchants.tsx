import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { statusColor, shortAddr } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { ConnectPrompt } from '@/components/ConnectPrompt';
import { LogoUpload } from '@/components/LogoUpload';
import IconPicker from '@/components/IconPicker';

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

export default function Merchants() {
  const { isConnected } = useAccount();
  const [rows, setRows]         = useState<Merchant[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [form, setForm]         = useState<MerchantForm>(EMPTY);
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logos, setLogos]       = useState<Record<string, string>>({});
  const [icons, setIcons]       = useState<Record<string, number | null>>({});

  function load() {
    apiFetch<Merchant[]>('/api/admin/merchants').then(setRows).catch(() => {});
    apiFetch<Country[]>('/api/admin/countries').then(setCountries).catch(() => {});
  }
  useEffect(load, []);

  // Load logo when row is expanded
  function toggleExpand(id: string) {
    setExpanded(e => e === id ? null : id);
    if (!logos[id]) {
      fetch(`/api/admin/merchants/${id}/logo`)
        .then(r => r.ok ? r.blob() : null)
        .then(blob => {
          if (!blob) return;
          const reader = new FileReader();
          reader.onload = e => setLogos(l => ({ ...l, [id]: e.target?.result as string }));
          reader.readAsDataURL(blob);
        })
        .catch(() => {});
    }
  }

  async function saveIcon(merchantId: string, iconId: number | null) {
    await apiFetch(`/api/admin/merchants/${merchantId}/icon`, {
      method: 'PATCH',
      body: JSON.stringify({ icon_id: iconId }),
    });
    setIcons(i => ({ ...i, [merchantId]: iconId }));
  }

  async function uploadLogo(merchantId: string, dataUri: string, mimeType: string) {
    await apiFetch(`/api/admin/merchants/${merchantId}/logo`, {
      method: 'PUT',
      body: JSON.stringify({ data_base64: dataUri, mime_type: mimeType }),
    });
    setLogos(l => ({ ...l, [merchantId]: dataUri }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await apiFetch('/api/admin/merchants', { method: 'POST', body: JSON.stringify(form) });
      setForm(EMPTY); setAdding(false); load();
    } catch (err: any) {
      setError(err.message ?? 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Merchants</h2>
        {isConnected && (
          <Button size="sm" onClick={() => setAdding(v => !v)}>
            {adding ? 'Cancel' : '+ Add Merchant'}
          </Button>
        )}
      </div>

      {!isConnected && <ConnectPrompt action="add or edit merchants" />}

      {isConnected && adding && (
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
            {error && <p className="col-span-3 text-red-600 text-sm">{error}</p>}
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
              {['','Name','Wallet','Country','Status','Created',''].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No merchants yet</td></tr>
            )}
            {rows.map(m => (
              <>
                <tr key={m.id} className="border-b hover:bg-gray-50">
                  {/* Logo thumbnail */}
                  <td className="px-4 py-3 w-12">
                    {logos[m.id]
                      ? <img src={logos[m.id]} className="w-8 h-8 rounded object-contain border" alt="" />
                      : <div className="w-8 h-8 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-300 text-xs">?</div>
                    }
                  </td>
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{shortAddr(m.wallet_address)}</td>
                  <td className="px-4 py-3">{m.country_code}</td>
                  <td className="px-4 py-3"><Badge className={statusColor(m.status)}>{m.status}</Badge></td>
                  <td className="px-4 py-3 text-gray-400">{new Date(m.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleExpand(m.id)}
                      className="text-xs text-brand-accent/60 hover:text-brand-accent"
                    >
                      {expanded === m.id ? 'Close ▲' : 'Edit ▼'}
                    </button>
                  </td>
                </tr>
                {expanded === m.id && (
                  <tr key={`${m.id}-expand`} className="border-b bg-gray-50">
                    <td colSpan={7} className="px-6 py-4">
                      <div className="flex gap-10 flex-wrap">
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Merchant Logo</p>
                          <LogoUpload
                            currentSrc={logos[m.id]}
                            onUpload={(uri, mime) => uploadLogo(m.id, uri, mime)}
                            size={96}
                            label={m.name}
                          />
                        </div>
                        <div className="min-w-56">
                          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Icon</p>
                          <IconPicker
                            value={icons[m.id] !== undefined ? icons[m.id] : (m.icon_id ?? null)}
                            onChange={(iconId) => saveIcon(m.id, iconId)}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
