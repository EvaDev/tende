import { useMemo, useState } from 'react';
import { Section, useReport, ReportState, shortHash, shortAddr } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface CurrencyRow {
  currency: string;
  token: string | null;
  credited: string;
  debited: string;
  net: string;
  netValue: number;
  users: number;
  lastActivity: string | null;
  consumerNet: string | null;
  merchantNet: string | null;
}

interface LedgerRow {
  blockNumber: number;
  logIndex: number;
  blockTime: string | null;
  direction: 'Credit' | 'Debit';
  type: string;
  user: string;
  userTag: string | null;
  amount: string;
  amountValue: number;
  currency: string;
  token: string | null;
  creditor: string | null;
  txHash: string;
}

interface BalancesData {
  byCurrency: CurrencyRow[];
  ledger: LedgerRow[];
}

const txLink = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
const money = (v: string) => <span className="tabular-nums">{v}</span>;
const currencyLabel = (fiat: string, token: string | null) =>
  token && token !== fiat ? `${fiat} · ${token}` : fiat;

export default function Balances() {
  const { data, loading, error } = useReport<BalancesData>('/api/admin/reports/balances');

  const [user, setUser]           = useState('');
  const [currency, setCurrency]   = useState('all');
  const [type, setType]           = useState('all');
  const [direction, setDirection] = useState('all');

  const ledger = data?.ledger ?? [];
  const currencyOptions = useMemo(() => [...new Set(ledger.map(l => l.currency))].sort(), [ledger]);
  const typeOptions     = useMemo(() => [...new Set(ledger.map(l => l.type))].sort(), [ledger]);

  const filtered = useMemo(() => {
    const u = user.trim().toLowerCase();
    return ledger.filter(l =>
      (currency === 'all'  || l.currency === currency) &&
      (type === 'all'      || l.type === type) &&
      (direction === 'all' || l.direction === direction) &&
      (!u || (l.userTag ?? '').toLowerCase().includes(u) || l.user.toLowerCase().includes(u)),
    );
  }, [ledger, user, currency, type, direction]);

  const anyFilter = user || currency !== 'all' || type !== 'all' || direction !== 'all';
  const clear = () => { setUser(''); setCurrency('all'); setType('all'); setDirection('all'); };

  // Render a wallet as its @tag (click to filter) with the address as a fallback/title.
  const userCell = (addr: string, tag: string | null) => (
    <button
      onClick={() => setUser(tag ?? addr)}
      title={addr}
      className="font-mono text-[11px] hover:text-brand-accent hover:underline"
    >
      {tag ? `@${tag}` : shortAddr(addr)}
    </button>
  );

  const currencyCols: Col<CurrencyRow>[] = [
    { key: 'currency', header: 'Currency', sort: r => r.currency,
      render: r => <span className="font-semibold">{currencyLabel(r.currency, r.token)}</span> },
    { key: 'credited', header: 'Credited', sort: r => Number(r.credited.replace(/,/g, '')), render: r => money(r.credited) },
    { key: 'debited',  header: 'Debited',  sort: r => Number(r.debited.replace(/,/g, '')),  render: r => money(r.debited) },
    { key: 'net',      header: 'Net held', sort: r => r.netValue,
      render: r => <span className="font-semibold text-brand-accent tabular-nums">{r.net}</span> },
    { key: 'consumers', header: 'Consumers', sort: r => Number((r.consumerNet ?? '0').replace(/,/g, '')),
      render: r => r.consumerNet != null ? money(r.consumerNet) : '—' },
    { key: 'merchants', header: 'Merchants', sort: r => Number((r.merchantNet ?? '0').replace(/,/g, '')),
      render: r => r.merchantNet != null ? money(r.merchantNet) : '—' },
    { key: 'users',    header: 'Users',    sort: r => r.users, render: r => r.users.toLocaleString() },
    { key: 'last',     header: 'Last activity', sort: r => r.lastActivity ?? '',
      render: r => (r.lastActivity ? new Date(r.lastActivity).toLocaleString() : '—') },
  ];

  const ledgerCols: Col<LedgerRow>[] = [
    { key: 'block', header: 'Block', sort: r => r.blockNumber + r.logIndex / 1e6, render: r => r.blockNumber },
    { key: 'time',  header: 'Time', sort: r => r.blockTime ?? '',
      render: r => (r.blockTime ? new Date(r.blockTime).toLocaleString() : '—') },
    { key: 'direction', header: 'Direction', sort: r => r.direction,
      render: r => <span className={r.direction === 'Credit' ? 'text-brand-accent font-medium' : 'text-brand-danger font-medium'}>{r.direction}</span> },
    { key: 'type', header: 'Type', sort: r => r.type, render: r => r.type },
    { key: 'user', header: 'User', sort: r => (r.userTag ?? r.user).toLowerCase(), render: r => userCell(r.user, r.userTag) },
    { key: 'amount', header: 'Amount', sort: r => r.amountValue, render: r => money(r.amount), className: 'text-right' },
    { key: 'currency', header: 'Currency', sort: r => r.currency, render: r => currencyLabel(r.currency, r.token) },
    { key: 'creditor', header: 'Creditor', sort: r => r.creditor ?? '',
      render: r => <span className="font-mono text-[11px]">{r.creditor ? shortAddr(r.creditor) : '—'}</span> },
    { key: 'tx', header: 'Tx', render: r => (
      <a href={txLink(r.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline hover:text-brand-accent">{shortHash(r.txHash)}</a>
    ) },
  ];

  const selectCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-accent/40';

  return (
    <Section title="Vault balances">
      <p className="text-sm text-gray-600">
        The Vault&apos;s per-currency user balance ledger, from <code>Credited</code> / <code>Debited</code> —
        top-ups, spends, FX conversion legs and manual adjustments. <strong>Credited</strong> and{' '}
        <strong>Debited</strong> sum admin ledger events only. <strong>Net held</strong> and the{' '}
        <strong>Consumers</strong> / <strong>Merchants</strong> columns use on-chain vault balances
        (authoritative for ZAR and USDC — harvest lifts USDC via price-per-share without{' '}
        <code>Credited</code> events). P2P moves are in <em>Transfers</em>; token mint/burn in{' '}
        <em>Mint &amp; Burn</em>.
      </p>
      <ReportState loading={loading} error={error} />
      {data && (
        <>
          {data.byCurrency.length > 0 ? (
            <SortableTable cols={currencyCols} rows={data.byCurrency} initialSort={{ key: 'net', dir: 'desc' }} />
          ) : <ReportState loading={false} error={null} empty />}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <h4 className="text-sm font-semibold text-gray-900 mr-auto">Ledger</h4>
            <input
              value={user} onChange={e => setUser(e.target.value)} placeholder="Filter by user / @tag…"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
            />
            <select value={currency} onChange={e => setCurrency(e.target.value)} className={selectCls}>
              <option value="all">All currencies</option>
              {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={type} onChange={e => setType(e.target.value)} className={selectCls}>
              <option value="all">All types</option>
              {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={direction} onChange={e => setDirection(e.target.value)} className={selectCls}>
              <option value="all">Credit &amp; Debit</option>
              <option value="Credit">Credit</option>
              <option value="Debit">Debit</option>
            </select>
            {anyFilter && (
              <button onClick={clear} className="text-sm text-brand-accent hover:underline">Clear</button>
            )}
          </div>

          {ledger.length > 0 ? (
            <>
              <SortableTable cols={ledgerCols} rows={filtered} initialSort={{ key: 'block', dir: 'desc' }} />
              <p className="text-xs text-gray-500">
                Showing {filtered.length} of {ledger.length} movements (latest 200 indexed). <strong>Creditor</strong> is
                the key that authorised a credit. Debits are gated by the admin-executor role but the on-chain
                <code>Debited</code> event carries no actor field, so it shows “—” — this does not mean a debit was unauthorised.
              </p>
            </>
          ) : <ReportState loading={false} error={null} empty />}
        </>
      )}
    </Section>
  );
}
