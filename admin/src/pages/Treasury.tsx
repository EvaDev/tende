import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch, api } from '@/lib/api';
import { useRole } from '@/hooks/useRole';

interface TreasuryInfo {
  ttza_balance: string;
  ttzw_balance: string;
  vault_usdc: string;
  ttza_address: string;
  ttzw_address: string;
  vault_address: string;
  dev_tools?: boolean;
}

// Currencies whose vault yield can be harvested, with display decimals.
const HARVEST_CURRENCIES = [
  { code: 'ZAR',  label: 'ZAR (treasury backing)', decimals: 2 },
  { code: 'USDC', label: 'USDC',                    decimals: 6 },
];

interface HarvestState {
  harvestable?: string;          // raw token units
  loading?: boolean;             // fetching harvestable
  busy?: boolean;                // harvest tx in flight
  message?: string;              // success/error feedback
  error?: boolean;
}

function fmtUnits(raw: string, decimals: number): string {
  return (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// Admin-only panel: preview and trigger vault yield harvesting per currency.
function HarvestPanel() {
  const [state, setState] = useState<Record<string, HarvestState>>({});

  const loadOne = useCallback(async (code: string) => {
    setState(s => ({ ...s, [code]: { ...s[code], loading: true } }));
    try {
      const r = await apiFetch<{ harvestable: string }>(`/api/admin/harvestable?currency=${code}`);
      setState(s => ({ ...s, [code]: { ...s[code], harvestable: r.harvestable, loading: false } }));
    } catch (e) {
      setState(s => ({ ...s, [code]: { ...s[code], loading: false, message: (e as Error).message, error: true } }));
    }
  }, []);

  useEffect(() => { HARVEST_CURRENCIES.forEach(c => loadOne(c.code)); }, [loadOne]);

  const harvest = async (code: string) => {
    setState(s => ({ ...s, [code]: { ...s[code], busy: true, message: undefined, error: false } }));
    try {
      const r = await api.post<{ userYield: string; platformCut: string; txHash: string }>(
        '/api/admin/harvest', { currency: code });
      const dec = HARVEST_CURRENCIES.find(c => c.code === code)?.decimals ?? 0;
      setState(s => ({ ...s, [code]: {
        ...s[code], busy: false, error: false,
        message: `Harvested — platform cut ${fmtUnits(r.platformCut, dec)}, to holders ${fmtUnits(r.userYield, dec)}`,
      } }));
      loadOne(code);
    } catch (e) {
      setState(s => ({ ...s, [code]: { ...s[code], busy: false, message: (e as Error).message, error: true } }));
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Yield Harvesting</CardTitle></CardHeader>
      <p className="text-sm text-gray-500 mb-4">
        Sweep the platform&apos;s share of accrued vault yield to the owner treasury; the remainder
        lifts every holder&apos;s balance via the share price. Signed by the backend wallet.
      </p>
      <div className="space-y-3">
        {HARVEST_CURRENCIES.map(({ code, label, decimals }) => {
          const st = state[code] ?? {};
          const has = st.harvestable != null && Number(st.harvestable) > 0;
          return (
            <div key={code} className="flex items-center justify-between gap-4 border-t border-gray-100 pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{label}</p>
                <p className="text-xs text-gray-500">
                  Harvestable: {st.loading ? '…' : st.harvestable != null ? fmtUnits(st.harvestable, decimals) : '—'}
                </p>
                {st.message && (
                  <p className={`text-xs mt-1 ${st.error ? 'text-red-600' : 'text-emerald-600'}`}>{st.message}</p>
                )}
              </div>
              <Button size="sm" disabled={st.busy || !has} onClick={() => harvest(code)}>
                {st.busy ? 'Harvesting…' : 'Harvest'}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// POC-only: simulate a fiat deposit on Sepolia. Mints TTZA backing into the Vault
// and credits the recipient's spendable Vault ZAR balance (the claim consumers
// actually hold/send). Backend hard-disables this in production.
function DevCashInPanel({ onDone }: { onDone: () => void }) {
  const [to, setTo]         = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState('');
  const [err, setErr]       = useState(false);

  async function submit() {
    setBusy(true); setMsg(''); setErr(false);
    try {
      const r = await api.post<{ creditTx: string }>('/api/admin/treasury/dev-credit', { to: to.trim(), amount });
      setMsg(`Credited R${parseFloat(amount).toFixed(2)} ZAR — tx ${r.creditTx.slice(0, 10)}…`);
      setTo(''); setAmount('');
      onDone();
    } catch (e) {
      setErr(true); setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Dev Cash-In <span className="text-xs font-normal text-gray-400">· POC only — disabled in production</span></CardTitle></CardHeader>
      <p className="text-sm text-gray-600 mb-3">
        Simulate a fiat deposit (Sepolia has no real cash-in rail): mints TTZA backing into the Vault and
        credits the recipient’s spendable ZAR balance. The recipient must be a registered consumer wallet
        with KYC level ≥ 1 to then send via the app.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={to} onChange={e => setTo(e.target.value)} placeholder="Recipient wallet (0x…)"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
        <input
          value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (ZAR)" inputMode="decimal"
          className="w-full sm:w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <Button onClick={submit} disabled={busy || !to || !amount}>{busy ? 'Minting…' : 'Mint & Credit'}</Button>
      </div>
      {msg && <p className={`text-sm mt-3 ${err ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>}
    </Card>
  );
}

export default function Treasury() {
  const [info, setInfo] = useState<TreasuryInfo | null>(null);
  const { isAdmin } = useRole();

  const load = useCallback(() => {
    apiFetch<TreasuryInfo>('/api/admin/treasury').then(setInfo).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const tiles = info
    ? [
        { label: 'TTZA Supply', value: `${(Number(info.ttza_balance) / 100).toLocaleString()} TTZA`, addr: info.ttza_address },
        { label: 'TTZW Supply', value: `${(Number(info.ttzw_balance) / 100).toLocaleString()} TTZW`, addr: info.ttzw_address },
        { label: 'Vault USDC',  value: `${(Number(info.vault_usdc) / 1e6).toLocaleString()} USDC`, addr: info.vault_address },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-brand-accent">Treasury</h2>
      {!info && <p className="text-gray-400 text-sm">Loading…</p>}
      <div className="grid grid-cols-3 gap-4">
        {tiles.map(({ label, value, addr }) => (
          <Card key={label}>
            <CardHeader><CardTitle className="text-xs uppercase tracking-wide text-gray-400">{label}</CardTitle></CardHeader>
            <p className="text-2xl font-bold text-brand-accent">{value}</p>
            <p className="font-mono text-xs text-gray-400 mt-2 break-all">{addr}</p>
          </Card>
        ))}
      </div>

      {isAdmin && <HarvestPanel />}

      {isAdmin && info?.dev_tools && <DevCashInPanel onDone={load} />}
    </div>
  );
}
