import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { SortableTable, type Col } from '@/components/SortableTable';
import { apiFetch } from '@/lib/api';
import { shortAddr } from '@/lib/utils';
import { useRole } from '@/hooks/useRole';

interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  currency_type: string;
  enabled: boolean;
  base_currency_code?: string | null;
  token_address?: string | null;
  is_deployed?: boolean;
}

interface CurrencyType { type_code: string; label: string; badge_class: string }

const EMPTY = { code: '', name: '', symbol: '', decimals: '2', currency_type: '', base_currency_code: '' };

function statusLabel(c: Currency): string {
  if (c.currency_type === 'TREASURY') return c.is_deployed ? 'Deployed' : 'Not deployed';
  return c.enabled ? 'Active' : 'Inactive';
}

export default function Currencies() {
  const { isAdmin } = useRole();
  const [rows, setRows] = useState<Currency[]>([]);
  const [types, setTypes] = useState<CurrencyType[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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
      const body = {
        ...form,
        decimals: Number(form.decimals),
        base_currency_code: form.currency_type === 'TREASURY' ? form.base_currency_code || undefined : undefined,
      };
      await apiFetch('/api/admin/currencies', { method: 'POST', body: JSON.stringify(body) });
      setForm(EMPTY); setAdding(false); load();
    } catch (err: unknown) { setError((err as Error).message ?? 'Failed'); } finally { setSaving(false); }
  }

  async function deployToken(code: string) {
    const row = rows.find(r => r.code === code);
    if (!row) return;
    if (!window.confirm(
      `Deploy ${code} on-chain?\n\nThis sends transactions from the deployer wallet: new ERC-1967 proxy + Vault wiring. This cannot be undone from the UI.`,
    )) return;
    setDeploying(code); setError('');
    try {
      await apiFetch(`/api/admin/currencies/${encodeURIComponent(code)}/deploy`, { method: 'POST', body: '{}' });
      load();
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Deploy failed');
    } finally { setDeploying(null); }
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(v => ({ ...v, [k]: e.target.value }));

  const filteredRows = useMemo(() => rows.filter(c => {
    if (typeFilter && c.currency_type !== typeFilter) return false;
    if (statusFilter && statusLabel(c) !== statusFilter) return false;
    return true;
  }), [rows, typeFilter, statusFilter]);

  const statusOptions = useMemo(() => [...new Set(rows.map(statusLabel))].sort(), [rows]);

  const cols: Col<Currency>[] = [
    { key: 'code', header: 'Code', sort: c => c.code, search: c => c.code,
      render: c => <span className="font-mono font-bold">{c.code}</span> },
    { key: 'name', header: 'Name', sort: c => c.name.toLowerCase(), search: c => c.name,
      render: c => c.name },
    { key: 'symbol', header: 'Symbol', sort: c => c.symbol, search: c => c.symbol,
      render: c => c.symbol },
    { key: 'decimals', header: 'Decimals', sort: c => c.decimals,
      render: c => c.decimals },
    { key: 'type', header: 'Type', sort: c => c.currency_type, search: c => c.currency_type,
      render: c => <Badge className={badgeClass(c.currency_type)}>{c.currency_type}</Badge> },
    { key: 'base', header: 'Fiat anchor', sort: c => c.base_currency_code ?? '',
      search: c => c.base_currency_code ?? '',
      render: c => c.base_currency_code ?? '—' },
    { key: 'token', header: 'Token', className: 'font-mono text-xs',
      sort: c => c.token_address ?? '',
      search: c => c.token_address ?? '',
      render: c => (c.token_address ? (
        <a
          href={`https://sepolia.etherscan.io/address/${c.token_address}`}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-brand-accent"
          onClick={e => e.stopPropagation()}
        >
          {shortAddr(c.token_address)}
        </a>
      ) : c.currency_type === 'TREASURY' && isAdmin ? (
        <Button size="sm" variant="outline" disabled={deploying === c.code} onClick={() => deployToken(c.code)}>
          {deploying === c.code ? 'Deploying…' : 'Deploy'}
        </Button>
      ) : '—') },
    { key: 'status', header: 'Status', sort: c => statusLabel(c), search: c => statusLabel(c),
      render: c => (
        <Badge className={c.enabled || c.is_deployed ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}>
          {statusLabel(c)}
        </Badge>
      ) },
  ];

  const filterSelectClass = 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-accent/40';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-brand-accent">Currencies</h2>
        {isAdmin && <Button size="sm" onClick={() => setAdding(v => !v)}>{adding ? 'Cancel' : '+ Add Currency'}</Button>}
      </div>

      {error && <p className="text-sm text-brand-danger">{error}</p>}

      {isAdmin && adding && (
        <Card>
          <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-4">
            <div><Label>Code</Label><Input value={form.code} onChange={f('code')} placeholder="e.g. TTMW" required /></div>
            <div><Label>Name</Label><Input value={form.name} onChange={f('name')} required /></div>
            <div><Label>Symbol</Label><Input value={form.symbol} onChange={f('symbol')} placeholder="e.g. TTMW" /></div>
            <div><Label>Decimals</Label><Input type="number" value={form.decimals} onChange={f('decimals')} min="0" max="18" /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.currency_type} onChange={f('currency_type')}>
                {types.map(t => <option key={t.type_code} value={t.type_code}>{t.label}</option>)}
              </Select>
            </div>
            {form.currency_type === 'TREASURY' && (
              <div>
                <Label>Fiat anchor</Label>
                <Input value={form.base_currency_code} onChange={f('base_currency_code')} placeholder="e.g. MWK" required />
              </div>
            )}
            <div className="col-span-3 text-xs text-gray-500">
              Saving only updates the database. Use <strong>Deploy</strong> on a treasury row to create the on-chain proxy instance.
            </div>
            <div className="col-span-3"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Currency'}</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <SortableTable
          cols={cols}
          rows={filteredRows}
          initialSort={{ key: 'code', dir: 'asc' }}
          searchable
          searchPlaceholder="Search code, name, symbol, type, anchor, token…"
          toolbarExtra={(
            <>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className={filterSelectClass}
                aria-label="Filter by type"
              >
                <option value="">All types</option>
                {types.map(t => <option key={t.type_code} value={t.type_code}>{t.label}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className={filterSelectClass}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {(typeFilter || statusFilter) && (
                <button
                  type="button"
                  onClick={() => { setTypeFilter(''); setStatusFilter(''); }}
                  className="text-xs text-gray-500 hover:text-brand-accent underline"
                >
                  Clear filters
                </button>
              )}
            </>
          )}
        />
      </Card>
    </div>
  );
}
