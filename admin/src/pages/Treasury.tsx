import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch, api } from '@/lib/api';
import { useRole } from '@/hooks/useRole';
import MerchantSettlementsPanel from '@/components/MerchantSettlementsPanel';

interface SupplyRow { token: string; label: string; address: string; decimals: number; supply: string; kind: 'treasury' | 'vault'; }
interface TreasuryInfo {
  supplies: SupplyRow[];
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
                  <p className={`text-xs mt-1 ${st.error ? 'text-brand-danger' : 'text-brand-accent'}`}>{st.message}</p>
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
  const [ref, setRef]       = useState('');
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState('');
  const [tx, setTx]         = useState('');
  const [err, setErr]       = useState(false);

  async function submit() {
    setBusy(true); setMsg(''); setTx(''); setErr(false);
    try {
      const r = await api.post<{ creditTx: string; reference: string }>('/api/admin/treasury/dev-credit', { to: to.trim(), amount, reference: ref.trim() });
      setMsg(`Credited R${parseFloat(amount).toFixed(2)} ZAR to ${to.trim()} (ref ${r.reference})`);
      setTx(r.creditTx);
      setAmount(''); setRef('');
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
        credits the recipient’s spendable ZAR balance.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={to} onChange={e => setTo(e.target.value)} placeholder="Recipient: @tag, account #, or 0x…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
        <input
          value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (ZAR)" inputMode="decimal"
          className="w-full sm:w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <Button onClick={submit} disabled={busy || !to || !amount}>{busy ? 'Minting…' : 'Mint & Credit'}</Button>
      </div>
      <input
        value={ref} onChange={e => setRef(e.target.value)} placeholder="Bank deposit reference (optional — auto-generated if blank)"
        className="w-full mt-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
      />
      {msg && (
        <p className={`text-sm mt-3 ${err ? 'text-brand-danger' : 'text-brand-accent'}`}>
          {msg}
          {tx && <> — <a href={`https://sepolia.etherscan.io/tx/${tx}`} target="_blank" rel="noreferrer" className="underline">view on Etherscan</a></>}
        </p>
      )}
    </Card>
  );
}

// POC-only: simulate the platform buying USDC reserves (mints mock USDC into the Vault).
function DevBuyUsdcPanel({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [ref, setRef]       = useState('');
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState('');
  const [tx, setTx]         = useState('');
  const [err, setErr]       = useState(false);

  async function submit() {
    setBusy(true); setMsg(''); setTx(''); setErr(false);
    try {
      const r = await api.post<{ mintTx: string; reference: string }>('/api/admin/treasury/buy-usdc', { amount, reference: ref.trim() });
      setMsg(`Added $${parseFloat(amount).toFixed(2)} USDC to the Vault reserve (ref ${r.reference})`);
      setTx(r.mintTx);
      setAmount(''); setRef('');
      onDone();
    } catch (e) {
      setErr(true); setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Simulate USDC Purchase <span className="text-xs font-normal text-gray-400">· POC only — disabled in production</span></CardTitle></CardHeader>
      <p className="text-sm text-gray-600 mb-3">
        Grow the platform’s USD reserve. On Sepolia there’s no real USDC purchase rail, so this mints the
        Vault’s mock USDC straight into the Vault — the reserve that backs consumers’ USD balances. It appears
        under “Underlying holdings · Vault USDC” above. On mainnet this would be a real fiat→USDC purchase.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (USD)" inputMode="decimal"
          className="w-full sm:w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={ref} onChange={e => setRef(e.target.value)} placeholder="Purchase reference (optional — auto-generated if blank)"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <Button onClick={submit} disabled={busy || !amount}>{busy ? 'Minting…' : 'Buy USDC'}</Button>
      </div>
      {msg && (
        <p className={`text-sm mt-3 ${err ? 'text-brand-danger' : 'text-brand-accent'}`}>
          {msg}
          {tx && <> — <a href={`https://sepolia.etherscan.io/tx/${tx}`} target="_blank" rel="noreferrer" className="underline">view on Etherscan</a></>}
        </p>
      )}
    </Card>
  );
}

// POC-only: set a consumer's on-chain KYC level (the Vault transfer gate reads it).
function DevKycPanel() {
  const [wallet, setWallet] = useState('');
  const [level, setLevel]   = useState('1');
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState('');
  const [tx, setTx]         = useState('');
  const [err, setErr]       = useState(false);

  async function submit() {
    setBusy(true); setMsg(''); setTx(''); setErr(false);
    try {
      const r = await api.post<{ level: number; txHash: string }>('/api/admin/consumers/kyc-level', { wallet: wallet.trim(), level: Number(level) });
      setMsg(`Set ${wallet.trim()} to Level ${r.level}`);
      setTx(r.txHash);
    } catch (e) {
      setErr(true); setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Set KYC Level <span className="text-xs font-normal text-gray-400">· POC only — disabled in production</span></CardTitle></CardHeader>
      <p className="text-sm text-gray-600 mb-3">
        Set a consumer’s on-chain KYC level (the Vault transfer gate reads this). Level 1+ is required to send.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input value={wallet} onChange={e => setWallet(e.target.value)} placeholder="Wallet (0x…), @tag, or account #"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
        <select value={level} onChange={e => setLevel(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          {[0, 1, 2, 3].map(n => <option key={n} value={n}>Level {n}</option>)}
        </select>
        <Button onClick={submit} disabled={busy || !wallet}>{busy ? 'Setting…' : 'Set Level'}</Button>
      </div>
      {msg && (
        <p className={`text-sm mt-3 ${err ? 'text-brand-danger' : 'text-brand-accent'}`}>
          {msg}
          {tx && <> — <a href={`https://sepolia.etherscan.io/tx/${tx}`} target="_blank" rel="noreferrer" className="underline">view on Etherscan</a></>}
        </p>
      )}
    </Card>
  );
}

export default function Treasury() {
  const [info, setInfo] = useState<TreasuryInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useRole();

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    apiFetch<TreasuryInfo>('/api/admin/treasury')
      .then(setInfo)
      .catch((e) => {
        setInfo(null);
        setLoadError(e instanceof Error ? e.message : 'Failed to load treasury');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmtSupply = (raw: string, decimals: number) =>
    (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-brand-accent">Treasury</h2>
      {loading && <p className="text-white text-sm">Loading…</p>}
      {loadError && !loading && (
        <p className="text-sm text-red-100 bg-red-900/40 border border-red-400/40 rounded-lg px-3 py-2">
          {loadError === 'Session expired'
            ? 'Connect the admin wallet to load treasury data, or enable Treasury under Settings → Public pages.'
            : loadError}
        </p>
      )}

      {/* Data-driven supply table — new tokens appear automatically. Minted = the
          closed-loop treasury tokens we issue; Holdings = assets the platform owns
          in the Vault (the reserve's underlying). */}
      <Card>
        <CardHeader><CardTitle>Token Supply &amp; Holdings</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-400">
              <tr className="text-left">
                <th className="font-medium pb-2">Asset</th>
                <th className="font-medium pb-2 text-right">Minted supply</th>
                <th className="font-medium pb-2 text-right">Underlying holdings</th>
                <th className="font-medium pb-2 pl-6">Contract</th>
              </tr>
            </thead>
            <tbody>
              {(info?.supplies ?? []).map((s) => {
                const amount = `${fmtSupply(s.supply, s.decimals)} ${s.token}`;
                return (
                  <tr key={s.token} className="border-t border-gray-100">
                    <td className="py-2 font-medium text-gray-900">
                      {s.token}
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{s.kind === 'treasury' ? 'treasury token' : 'vault holding'}</span>
                    </td>
                    <td className="py-2 text-right font-bold text-brand-accent">{s.kind === 'treasury' ? amount : '—'}</td>
                    <td className="py-2 text-right font-bold text-brand-accent">{s.kind === 'vault' ? amount : '—'}</td>
                    <td className="py-2 pl-6 font-mono text-xs text-gray-400 break-all">
                      {s.address ? (
                        <a href={`https://sepolia.etherscan.io/address/${s.address}`} target="_blank" rel="noreferrer" className="hover:text-brand-accent underline">{s.address}</a>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
              {!loading && !loadError && (info?.supplies?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-gray-400">No treasury tokens registered yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {isAdmin && <MerchantSettlementsPanel compact />}

      {isAdmin && <HarvestPanel />}

      {isAdmin && info?.dev_tools && <DevCashInPanel onDone={load} />}

      {isAdmin && info?.dev_tools && <DevBuyUsdcPanel onDone={load} />}

      {isAdmin && info?.dev_tools && <DevKycPanel />}
    </div>
  );
}
