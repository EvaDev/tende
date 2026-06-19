import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch, AuthError } from '@/lib/api';
import { useRole } from '@/hooks/useRole';

interface Asset {
  asset_id: number;
  symbol: string; name: string; asset_class: string;
  contract_address: string; chain_id: number; decimals: number; issuer: string | null;
  price_source: string; price_usd: string | null; live_price_usd: number | null;
  quote_token: string; pool_fee_tier: number; markup_bps: number;
  enabled: boolean; buy_enabled: boolean; sell_enabled: boolean;
  min_trade_usd: string; max_trade_usd: string | null; min_kyc_tier: number;
}

const CLASS_COLORS: Record<string, string> = {
  COMMODITY:  'bg-amber-100 text-amber-800',
  EQUITY:     'bg-blue-100 text-blue-800',
  CRYPTO:     'bg-purple-100 text-purple-800',
  STABLECOIN: 'bg-green-100 text-green-800',
};
const FEE_LABEL: Record<number, string> = { 100: '0.01%', 500: '0.05%', 3000: '0.3%', 10000: '1%' };

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-accent' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

const EMPTY = {
  contract_address: '', chain_id: '1', symbol: '', name: '', decimals: '18',
  asset_class: 'COMMODITY', issuer: '', price_source: 'dex_quote', pool_fee_tier: '500', markup_bps: '0',
};

export default function Assets() {
  const { isAdmin } = useRole();
  const [rows, setRows]     = useState<Asset[] | null>(null);
  const [error, setError]   = useState<'auth' | 'other' | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm]     = useState(EMPTY);
  const [busy, setBusy]     = useState(false);
  const [formErr, setFormErr] = useState('');

  function load() {
    apiFetch<Asset[]>('/api/admin/assets').then(r => { setRows(r); setError(null); })
      .catch(e => setError(e instanceof AuthError ? 'auth' : 'other'));
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold text-brand-accent mb-3">Assets</h2>
        <Card><p className="text-sm text-gray-600">Connect the <strong>administrator wallet</strong> to manage tradeable assets.</p></Card>
      </div>
    );
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(v => ({ ...v, [k]: e.target.value }));

  async function fetchMeta() {
    setFormErr(''); setBusy(true);
    try {
      const m = await apiFetch<{ symbol: string; name: string; decimals: number }>(
        `/api/admin/asset-metadata?address=${form.contract_address}&chainId=${form.chain_id}`);
      setForm(v => ({ ...v, symbol: m.symbol, name: m.name, decimals: String(m.decimals) }));
    } catch (e) { setFormErr((e as Error).message); } finally { setBusy(false); }
  }

  async function create() {
    setFormErr(''); setBusy(true);
    try {
      await apiFetch('/api/admin/assets', { method: 'POST', body: JSON.stringify({
        ...form, chain_id: Number(form.chain_id), decimals: Number(form.decimals),
        pool_fee_tier: Number(form.pool_fee_tier), markup_bps: Number(form.markup_bps),
      }) });
      setForm(EMPTY); setAdding(false); load();
    } catch (e) { setFormErr((e as Error).message); } finally { setBusy(false); }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const saved = await apiFetch<Asset>(`/api/admin/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    setRows(rs => rs?.map(r => r.asset_id === id ? saved : r) ?? null);
  }

  const fmtUsd = (n: number | null) => n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Tradeable Assets</h2>
        <Button size="sm" onClick={() => setAdding(v => !v)}>{adding ? 'Cancel' : '+ List Asset'}</Button>
      </div>

      {error === 'auth' && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">Admin session expired — reconnect your wallet.</div>}
      {error === 'other' && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">Could not load assets.</div>}

      {adding && (
        <Card className="space-y-4">
          <CardHeader><CardTitle>List a new asset</CardTitle></CardHeader>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2"><Label>Contract Address</Label><Input value={form.contract_address} onChange={f('contract_address')} placeholder="0x…" /></div>
            <div><Label>Chain ID</Label><Input type="number" value={form.chain_id} onChange={f('chain_id')} /></div>
          </div>
          <Button size="sm" variant="outline" onClick={fetchMeta} disabled={busy || !form.contract_address}>
            {busy ? 'Reading…' : 'Fetch token details'}
          </Button>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>Symbol</Label><Input value={form.symbol} onChange={f('symbol')} /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={f('name')} /></div>
            <div><Label>Decimals</Label><Input type="number" value={form.decimals} onChange={f('decimals')} /></div>
            <div>
              <Label>Class</Label>
              <Select value={form.asset_class} onChange={f('asset_class')}>
                {Object.keys(CLASS_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="col-span-2"><Label>Issuer</Label><Input value={form.issuer} onChange={f('issuer')} placeholder="e.g. Paxos" /></div>
            <div>
              <Label>Price Source</Label>
              <Select value={form.price_source} onChange={f('price_source')}>
                <option value="dex_quote">Uniswap (live)</option>
                <option value="manual">Manual</option>
              </Select>
            </div>
            <div>
              <Label>Uniswap Fee Tier</Label>
              <Select value={form.pool_fee_tier} onChange={f('pool_fee_tier')} disabled={form.price_source !== 'dex_quote'}>
                {Object.entries(FEE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div><Label>Markup (bps)</Label><Input type="number" value={form.markup_bps} onChange={f('markup_bps')} /></div>
          </div>
          {formErr && <p className="text-sm text-red-600">{formErr}</p>}
          <Button onClick={create} disabled={busy || !form.symbol}>Add (disabled until enabled)</Button>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>{['Asset','Class','Price (USD)','Markup','KYC','Listed','Buy','Sell','Chain'].map(h =>
              <th key={h} className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows === null && !error && <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">No assets listed yet.</td></tr>}
            {rows?.map(a => (
              <tr key={a.asset_id} className="hover:bg-gray-50 align-middle">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{a.symbol}</div>
                  <div className="text-xs text-gray-500">{a.name}</div>
                </td>
                <td className="px-3 py-2"><Badge className={CLASS_COLORS[a.asset_class] ?? 'bg-gray-100 text-gray-600'}>{a.asset_class}</Badge></td>
                <td className="px-3 py-2">
                  {a.price_source === 'dex_quote' ? (
                    <div>
                      <div className="font-medium text-gray-900">{fmtUsd(a.live_price_usd)}</div>
                      <div className="text-xs text-gray-400">Uniswap {FEE_LABEL[a.pool_fee_tier] ?? a.pool_fee_tier}</div>
                    </div>
                  ) : (
                    <Input type="number" className="w-28 h-7 text-xs" defaultValue={a.price_usd ?? ''} placeholder="set price"
                      onBlur={e => { const v = e.target.value; if (v !== (a.price_usd ?? '')) patch(a.asset_id, { price_usd: v === '' ? null : Number(v) }); }} />
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <Input type="number" className="w-16 h-7 text-xs" defaultValue={a.markup_bps}
                      onBlur={e => { const v = Number(e.target.value); if (v !== a.markup_bps) patch(a.asset_id, { markup_bps: v }); }} />
                    <span className="text-xs text-gray-400">bps</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Select className="w-16 h-7 text-xs" value={a.min_kyc_tier} onChange={e => patch(a.asset_id, { min_kyc_tier: Number(e.target.value) })}>
                    {[0,1,2,3].map(t => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2"><Toggle checked={a.enabled} onChange={v => patch(a.asset_id, { enabled: v })} /></td>
                <td className="px-3 py-2"><Toggle checked={a.buy_enabled} onChange={v => patch(a.asset_id, { buy_enabled: v })} /></td>
                <td className="px-3 py-2"><Toggle checked={a.sell_enabled} onChange={v => patch(a.asset_id, { sell_enabled: v })} /></td>
                <td className="px-3 py-2 text-gray-500">{a.chain_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 px-4 py-3 border-t bg-gray-50">
          <strong>Price</strong> for Uniswap assets is live (USDC quote, read-only). <strong>Markup</strong> is the
          platform's spread in basis points (100 bps = 1%), added to the DEX price the consumer pays. Listing =
          <strong> Listed</strong> on; consumers only see/trade assets that are Listed and meet the KYC tier.
          Settlement currency is USDC.
        </p>
      </Card>
    </div>
  );
}
