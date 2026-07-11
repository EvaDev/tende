import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch, AuthError } from '@/lib/api';
import { refreshAppConfig } from '@/hooks/useAppConfig';
import { fmt } from '@/lib/utils';
import { LogoUpload } from '@/components/LogoUpload';
import { ConnectPrompt } from '@/components/ConnectPrompt';
import { useRole } from '@/hooks/useRole';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConfigMap { [key: string]: string }

interface KycLevel {
  level_id: number;
  country_code: string;
  level_name: string;
  max_single_tx: string;
  max_daily_send: string;
  max_monthly_spend: string;
  max_wallet_balance: string;
  requires_full_name: boolean;
  requires_mobile: boolean;
  requires_id_doc: boolean;
  requires_biometric: boolean;
  allows_remittance: boolean;
  allows_usd_savings: boolean;
  idos_credential_required: boolean;
}

interface Country { code: string; name: string }

// ── Toggle component ─────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-accent' : 'bg-gray-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function ToggleRow({ label, description, value, onChange, disabled }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b last:border-0">
      <div className="flex-1">
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
        <Toggle checked={value} onChange={onChange} disabled={disabled} />
        <span className="text-sm text-gray-500 w-6">{value ? 'On' : 'Off'}</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// Admin pages that can be opted into public (no-login) read-only viewing. Keys must
// match the route path (nav item `to` minus '/') and the backend page keys.
const PUBLIC_PAGE_OPTIONS = [
  { key: 'reports',      label: 'Reports',      desc: 'On-chain activity, sign-up funnel, balances and revenue.' },
  { key: 'treasury',     label: 'Treasury',     desc: 'Token supply and reserve holdings.' },
  { key: 'registration', label: 'Registration', desc: 'The consumer sign-up field configuration.' },
  { key: 'assets',       label: 'Assets',       desc: 'Tradeable asset registry and pricing.' },
  { key: 'contracts',    label: 'Contracts',    desc: 'Deployed contract addresses and live versions.' },
];

export default function SettingsPage() {
  const { isConnected } = useAccount();
  const { isAdmin } = useRole();
  const [config, setConfig]       = useState<ConfigMap | null>(null);
  const [configError, setConfigError] = useState<'auth' | 'other' | null>(null);
  const [saving, setSaving]       = useState<string | null>(null);
  const [saved, setSaved]         = useState<string | null>(null);

  // KYC
  const [countries, setCountries]   = useState<Country[]>([]);
  const [kycCountry, setKycCountry] = useState('');
  const [kycLevels, setKycLevels]   = useState<KycLevel[]>([]);
  const [kycDraft, setKycDraft]     = useState<Record<number, Partial<KycLevel>>>({});
  const [kycSaving, setKycSaving]   = useState(false);
  const [kycSaved, setKycSaved]     = useState(false);

  useEffect(() => {
    apiFetch<ConfigMap>('/api/config/all')
      .then(rows => {
        // /api/config/all returns an array of {key,value,description}; normalise to map
        const map: ConfigMap = {};
        if (Array.isArray(rows)) (rows as {key:string;value:string}[]).forEach(r => { map[r.key] = r.value; });
        else Object.assign(map, rows);
        setConfig(map);
        setConfigError(null);
      })
      .catch(e => { setConfigError(e instanceof AuthError ? 'auth' : 'other'); });
    apiFetch<Country[]>('/api/admin/countries').then(setCountries).catch(() => {});
  }, []);

  useEffect(() => {
    if (!kycCountry) return;
    apiFetch<KycLevel[]>(`/api/admin/kyc-levels?country=${kycCountry}`)
      .then(rows => { setKycLevels(rows); setKycDraft({}); })
      .catch(() => {});
  }, [kycCountry]);

  async function saveConfig(key: string, value: string) {
    setSaving(key);
    try {
      await apiFetch(`/api/config/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ value }) });
      await refreshAppConfig();
      setConfig(c => ({ ...(c ?? {}), [key]: value }));
      setSaved(key); setTimeout(() => setSaved(null), 2000);
    } finally { setSaving(null); }
  }

  function toggleConfig(key: string, current: string) {
    const next = current === 'true' ? 'false' : 'true';
    setConfig(c => ({ ...(c ?? {}), [key]: next }));
    saveConfig(key, next);
  }

  // Public read-only pages are stored as a CSV in the `app.public_pages` config key.
  const publicPages = (config?.['app.public_pages'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  function togglePublicPage(key: string) {
    const set = new Set(publicPages);
    set.has(key) ? set.delete(key) : set.add(key);
    const csv = [...set].join(',');
    setConfig(c => ({ ...(c ?? {}), 'app.public_pages': csv }));
    saveConfig('app.public_pages', csv);
  }

  async function saveKyc() {
    setKycSaving(true);
    try {
      await Promise.all(
        Object.entries(kycDraft).map(([id, patch]) =>
          apiFetch(`/api/admin/kyc-levels/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
        ),
      );
      setKycDraft({});
      setKycSaved(true); setTimeout(() => setKycSaved(false), 2000);
      apiFetch<KycLevel[]>(`/api/admin/kyc-levels?country=${kycCountry}`).then(setKycLevels).catch(() => {});
    } finally { setKycSaving(false); }
  }

  function patchKyc(id: number, field: string, value: string | boolean) {
    setKycDraft(d => ({ ...d, [id]: { ...d[id], [field]: value } }));
    setKycLevels(rows => rows.map(r => r.level_id === id ? { ...r, [field]: value } : r));
  }

  // helper to render a single text/color config field with save button.
  // Only renders when config is loaded from DB — never uses hardcoded fallbacks.
  function configField(key: string, label: string, type = 'text') {
    if (!config) return null;
    const rawVal = config[key] ?? '';
    const displayVal = type === 'color'
      ? (rawVal ? (rawVal.startsWith('#') ? rawVal : `#${rawVal}`) : '')
      : rawVal;
    return (
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label>{label}</Label>
          <Input type={type} value={displayVal} disabled={!isAdmin} onChange={e => {
            const v = type === 'color' ? e.target.value.replace('#', '') : e.target.value;
            setConfig(c => ({ ...c, [key]: v }));
          }} />
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={() => saveConfig(key, config[key] ?? '')} disabled={saving === key}>
            {saved === key ? 'Saved ✓' : saving === key ? '…' : 'Save'}
          </Button>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-brand-accent">Settings</h2>

      {!isConnected && <ConnectPrompt action="save settings" />}

      {isConnected && !isAdmin && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Read-only — these are platform settings. Only an admin can change them.
        </div>
      )}

      {configError === 'auth' && (
        <div className="rounded-xl border border-brand-accent/30 bg-brand-accent/10 px-4 py-3 flex items-start gap-3">
          <span className="text-brand-accent text-lg mt-0.5">⚠</span>
          <div>
            <p className="font-semibold text-brand-accent">Session expired</p>
            <p className="text-sm text-brand-accent mt-0.5">
              Your admin session has expired. Disconnect and reconnect your wallet to load settings.
              Settings are <strong>not shown</strong> until loaded from the database — no stale values will be saved.
            </p>
          </div>
        </div>
      )}

      {configError === 'other' && (
        <div className="rounded-xl border border-brand-danger/30 bg-brand-danger/10 px-4 py-3 text-brand-danger text-sm">
          Could not load settings from the server. Check that the backend is running.
        </div>
      )}

      {/* ── Payment relay ── */}
      {config && <Card>
        <CardHeader><CardTitle>Payment relay (gas)</CardTitle></CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-1">
          Controls how consumer payments are authorized on-chain. The platform always pays gas;
          these settings change <em>how much</em> gas each payment costs.
        </p>
        <ToggleRow
          label="Session keys (recommended for micropayments)"
          description="On: passkey approves once per 24h session; individual payments use a cheap device session key (~90k gas vs ~330k with WebAuthn every time). Off: every payment requires a passkey signature (safer, more expensive). Requires SessionTransferModule deployed — set SESSION_TRANSFER_MODULE_ADDRESS on the API. Existing Safes registered before the module was wired need a one-time module enable."
          value={config['feature.session_keys'] === 'true'}
          disabled={!isAdmin}
          onChange={() => toggleConfig('feature.session_keys', config['feature.session_keys'] ?? 'false')}
        />
      </Card>}

      {/* ── Consumer feature flags — only shown when config is loaded ── */}
      {config && <Card>
        <CardHeader><CardTitle>Consumer App Features</CardTitle></CardHeader>
        <ToggleRow
          label="Consumer wallet allows purchases"
          description="When on, the consumer app shows the Buy Product flow (scan QR / enter product ID). When off, purchasing is disabled."
          value={config['feature.consumer.purchases'] === 'true'}
          disabled={!isAdmin}
          onChange={() => toggleConfig('feature.consumer.purchases', config['feature.consumer.purchases'] ?? 'false')}
        />
        <ToggleRow
          label="Consumer wallet allows lending"
          description="When on, the consumer app shows the Lend & Borrow page. When off, that page is hidden."
          value={config['feature.consumer.lending'] === 'true'}
          disabled={!isAdmin}
          onChange={() => toggleConfig('feature.consumer.lending', config['feature.consumer.lending'] ?? 'false')}
        />
        <ToggleRow
          label="Consumer wallet allows family member linking"
          description="When on, the consumer app shows the Family Members page. When off, it is hidden."
          value={config['feature.consumer.family'] === 'true'}
          disabled={!isAdmin}
          onChange={() => toggleConfig('feature.consumer.family', config['feature.consumer.family'] ?? 'false')}
        />
      </Card>}

      {/* ── Public (no-login) pages ── */}
      {config && <Card>
        <CardHeader><CardTitle>Public pages (no login)</CardTitle></CardHeader>
        <p className="text-sm text-gray-500 -mt-2 mb-1">
          Pages toggled on here are visible <strong>read-only to anyone</strong> who opens the console
          without connecting a wallet — including the data they show. Write actions always require an
          admin login. Everything is off by default.
        </p>
        {PUBLIC_PAGE_OPTIONS.map(p => (
          <ToggleRow
            key={p.key}
            label={p.label}
            description={p.desc}
            value={publicPages.includes(p.key)}
            disabled={!isAdmin}
            onChange={() => togglePublicPage(p.key)}
          />
        ))}
      </Card>}

      {/* ── KYC levels ── */}
      <Card>
        <CardHeader><CardTitle>Country Remittance Limits (KYC Tiers)</CardTitle></CardHeader>
        <div className="mb-4">
          <Label>Country</Label>
          <Select value={kycCountry} onChange={e => setKycCountry(e.target.value)} className="w-48">
            <option value="">Select…</option>
            {countries.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </Select>
        </div>

        {kycCountry && kycLevels.length === 0 && (
          <p className="text-sm text-gray-400 italic">No KYC levels configured for {kycCountry}.</p>
        )}

        {kycLevels.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    {['Tier', 'Single Tx (R)', 'Daily Send (R)', 'Monthly (R)', 'Full Name', 'Mobile', 'ID Doc', 'Biometric', 'Remittance', 'idOS'].map(h =>
                      <th key={h} className="text-left pb-2 pr-4 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {kycLevels.map(lv => (
                    <tr key={lv.level_id} className="align-middle">
                      <td className="py-2 pr-4 font-medium text-xs whitespace-nowrap">{lv.level_name}</td>
                      {(['max_single_tx','max_daily_send','max_monthly_spend'] as const).map(field => (
                        <td key={field} className="py-2 pr-3">
                          <Input
                            type="number"
                            className="w-28 h-7 text-xs"
                            disabled={!isAdmin}
                            value={String(Math.round(Number(lv[field]) / 100))}
                            onChange={e => patchKyc(lv.level_id, field, String(Number(e.target.value) * 100))}
                          />
                        </td>
                      ))}
                      {(['requires_full_name','requires_mobile','requires_id_doc','requires_biometric','allows_remittance','idos_credential_required'] as const).map(field => (
                        <td key={field} className="py-2 pr-3">
                          <Toggle checked={!!lv[field]} disabled={!isAdmin} onChange={v => patchKyc(lv.level_id, field, v)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isAdmin && (
              <div className="mt-4 flex items-center gap-3">
                <Button size="sm" onClick={saveKyc} disabled={kycSaving || Object.keys(kycDraft).length === 0}>
                  {kycSaved ? 'Saved ✓' : kycSaving ? 'Saving…' : 'Save Limits'}
                </Button>
                {Object.keys(kycDraft).length > 0 && <span className="text-xs text-brand-accent">Unsaved changes</span>}
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── Branding — only shown when config is loaded from DB ── */}
      {config && <Card className="space-y-4">
        <CardHeader><CardTitle>App Branding</CardTitle></CardHeader>
        {isAdmin ? (
          <LogoUpload
            currentSrc={config['app.logo'] || undefined}
            onUpload={async (uri) => saveConfig('app.logo', uri)}
            size={96}
            label="App Logo"
          />
        ) : config['app.logo'] ? (
          <div>
            <Label>App Logo</Label>
            <img src={config['app.logo']} alt="App logo" className="w-24 h-24 rounded-xl object-contain border bg-gray-50 p-1" />
          </div>
        ) : null}
        {configField('app.name', 'App Name')}
        {configField('brand.color.bg', 'Background Color', 'color')}
        {configField('brand.color.accent', 'Accent Color', 'color')}
        {configField('brand.color.text', 'Text Color', 'color')}
      </Card>}

      {/* ── Revenue rates ── */}
      {config && <Card className="space-y-4">
        <CardHeader><CardTitle>Revenue</CardTitle></CardHeader>
        <p className="text-sm text-gray-500 -mt-2">
          Platform fee rates. Vault <strong>yield share</strong> is harvested from{' '}
          <a href="/treasury" className="text-brand-accent underline">Treasury → Yield Harvesting</a>
          {' '}(default 1000 bps / 10% via <code>PLATFORM_HARVEST_FEE_BPS</code> env until moved here).
        </p>
        <div>
          {configField('revenue.fx_spread_bps', 'FX conversion spread (basis points)')}
          <p className="text-xs text-gray-400 mt-1">Applied to consumer ZAR → USD conversions. 150 bps = 1.5%.</p>
        </div>
        <div>
          {configField('revenue.settlement_fee_bps', 'Merchant settlement fee (basis points)')}
          <p className="text-xs text-gray-400 mt-1">
            Deducted from the fiat bank payout when a merchant settles. Tokens withdrawn include the fee;
            the platform retains it when paying out.
          </p>
        </div>
      </Card>}

      {/* ── Pilot config — only shown when config is loaded from DB ── */}
      {config && <Card className="space-y-4">
        <CardHeader><CardTitle>Pilot Config</CardTitle></CardHeader>
        {configField('pilot.send_countries',   'Send Countries (comma-separated ISO codes)')}
        {configField('pilot.receive_countries','Receive Countries (comma-separated ISO codes)')}
        {configField('pilot.max_transfer_zar', 'Max Transfer (ZAR cents)')}
      </Card>}
    </div>
  );
}
