import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SortableTable, type Col } from '@/components/SortableTable';
import { apiFetch, api } from '@/lib/api';
import { statusColor, shortAddr } from '@/lib/utils';
import { useRole } from '@/hooks/useRole';
import { ConnectPrompt } from '@/components/ConnectPrompt';

interface Claim {
  id: string;
  sender: string;
  recipientMasked: string;
  amount: string;
  currency: string;
  status: string;
  escrowTx: string | null;
  releaseTx: string | null;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}

interface LedgerRow {
  kind: 'whatsapp' | 'purchase' | 'unallocated';
  detail: string;
  from: string;
  fromLabel: string;
  amount: string;
  currency: string;
  txHash: string;
  createdAt: string | null;
}

interface PurchaseHold {
  saleId: string;
  fromLabel: string;
  merchantName: string;
  amount: string;
  currency: string;
  fulfilmentStatus: string | null;
  escrowTx: string | null;
  createdAt: string;
}

interface EscrowData {
  escrowAddress: string | null;
  counts: { pending: number; claimed: number; reclaimed: number; purchasesPending?: number };
  held?: { currency: string; amount: string }[];
  outstanding: { currency: string; amount: string }[];
  whatsappOutstanding?: { currency: string; amount: string }[];
  claims: Claim[];
  purchasesPending?: PurchaseHold[];
  ledger?: LedgerRow[];
}

const sym = (c: string) => (c === 'USD' || c === 'USDC' ? '$' : c === 'ZAR' ? 'R' : '');

const claimCols: Col<Claim>[] = [
  { key: 'sender', header: 'Sender', className: 'px-4 py-3 font-mono text-xs',
    search: c => c.sender, sort: c => c.sender,
    render: c => c.sender },
  { key: 'recipient', header: 'Recipient', className: 'px-4 py-3 font-mono text-xs',
    search: c => c.recipientMasked, sort: c => c.recipientMasked,
    render: c => c.recipientMasked },
  { key: 'amount', header: 'Amount', className: 'px-4 py-3 font-medium',
    sort: c => Number(c.amount),
    render: c => <>{sym(c.currency)}{Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</> },
  { key: 'status', header: 'Status', className: 'px-4 py-3',
    sort: c => (c.expired ? 'expired' : c.status),
    render: c => <Badge className={statusColor(c.expired ? 'EXPIRED' : c.status)}>{c.expired ? 'expired' : c.status}</Badge> },
  { key: 'created', header: 'Created', className: 'px-4 py-3 text-gray-400',
    sort: c => c.createdAt,
    render: c => new Date(c.createdAt).toLocaleDateString() },
  { key: 'expires', header: 'Expires', className: 'px-4 py-3 text-gray-400',
    sort: c => c.expiresAt,
    render: c => new Date(c.expiresAt).toLocaleDateString() },
  { key: 'tx', header: 'Tx', className: 'px-4 py-3',
    search: c => c.releaseTx ?? c.escrowTx ?? '',
    render: c => ((c.releaseTx ?? c.escrowTx)
      ? <a href={`https://sepolia.etherscan.io/tx/${c.releaseTx ?? c.escrowTx}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline hover:text-brand-accent">{shortAddr(c.releaseTx ?? c.escrowTx!)}</a>
      : <span className="text-gray-300">—</span>) },
];

const ledgerCols: Col<LedgerRow>[] = [
  { key: 'when', header: 'When', className: 'px-4 py-3 text-gray-500 whitespace-nowrap',
    sort: r => r.createdAt ?? '',
    render: r => (r.createdAt ? new Date(r.createdAt).toLocaleString() : '—') },
  { key: 'from', header: 'From', className: 'px-4 py-3',
    search: r => `${r.fromLabel} ${r.from}`, sort: r => r.fromLabel,
    render: r => <span className="font-mono text-xs">{r.fromLabel}</span> },
  { key: 'kind', header: 'Type', className: 'px-4 py-3',
    sort: r => r.kind,
    render: r => (
      <Badge className={
        r.kind === 'whatsapp' ? statusColor('PENDING')
          : r.kind === 'purchase' ? statusColor('APPROVED')
            : statusColor('EXPIRED')
      }>
        {r.kind === 'unallocated' ? 'unallocated' : r.kind}
      </Badge>
    ) },
  { key: 'detail', header: 'Detail', className: 'px-4 py-3 text-sm text-gray-700',
    search: r => r.detail, sort: r => r.detail,
    render: r => r.detail },
  { key: 'amount', header: 'Amount', className: 'px-4 py-3 font-medium tabular-nums',
    sort: r => Number(r.amount),
    render: r => <>{sym(r.currency)}{Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs text-gray-400">{r.currency}</span></> },
  { key: 'tx', header: 'Tx', className: 'px-4 py-3',
    search: r => r.txHash,
    render: r => (
      <a href={`https://sepolia.etherscan.io/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline hover:text-brand-accent">
        {shortAddr(r.txHash)}
      </a>
    ) },
];

const purchaseCols: Col<PurchaseHold>[] = [
  { key: 'when', header: 'Created', className: 'px-4 py-3 text-gray-500',
    sort: p => p.createdAt, render: p => new Date(p.createdAt).toLocaleString() },
  { key: 'from', header: 'Consumer', className: 'px-4 py-3 font-mono text-xs',
    search: p => p.fromLabel, sort: p => p.fromLabel, render: p => p.fromLabel },
  { key: 'merchant', header: 'Merchant', className: 'px-4 py-3',
    search: p => p.merchantName, sort: p => p.merchantName, render: p => p.merchantName },
  { key: 'amount', header: 'Amount', className: 'px-4 py-3 font-medium tabular-nums',
    sort: p => Number(p.amount),
    render: p => <>{sym(p.currency)}{Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</> },
  { key: 'status', header: 'Fulfilment', className: 'px-4 py-3',
    sort: p => p.fulfilmentStatus ?? '',
    render: p => <Badge className={statusColor(p.fulfilmentStatus ?? 'pending')}>{p.fulfilmentStatus ?? 'pending'}</Badge> },
  { key: 'tx', header: 'Tx', className: 'px-4 py-3',
    search: p => p.escrowTx ?? '',
    render: p => (p.escrowTx
      ? <a href={`https://sepolia.etherscan.io/tx/${p.escrowTx}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] underline hover:text-brand-accent">{shortAddr(p.escrowTx)}</a>
      : '—') },
];

function HeldAmounts({ rows }: { rows: { currency: string; amount: string }[] }) {
  if (!rows.length) return <p className="text-xl font-bold text-brand-accent mt-1">—</p>;
  return (
    <>
      {rows.map(o => (
        <p key={o.currency} className="text-xl font-bold text-brand-accent mt-1">
          {sym(o.currency)}{Number(o.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
          <span className="text-xs text-gray-400">{o.currency}</span>
        </p>
      ))}
    </>
  );
}

export default function Escrow() {
  const { isAdmin } = useRole();
  const [data, setData]   = useState<EscrowData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');

  function load() {
    apiFetch<EscrowData>('/api/admin/escrow').then(setData).catch(e => setError((e as Error).message));
  }
  useEffect(load, []);

  async function reclaimExpired() {
    setBusy(true); setMsg('');
    try {
      const r = await api.post<{ reclaimed: number }>('/api/admin/claims/reclaim-expired', {});
      setMsg(`Reclaimed ${r.reclaimed} expired claim(s) back to senders.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally { setBusy(false); }
  }

  if (!isAdmin) return <ConnectPrompt action="view escrow" />;

  const held = data?.held ?? data?.outstanding ?? [];
  const unallocated = (data?.ledger ?? []).filter(r => r.kind === 'unallocated');

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Escrow</h2>
          <p className="text-sm text-white/70 mt-1">
            Funds held at the platform escrow address — WhatsApp claims, purchase fulfilment holds,
            and any other inbound Vault transfers. Live Vault balance is the source of truth for outstanding.
          </p>
        </div>
        <Button size="sm" onClick={reclaimExpired} disabled={busy}>{busy ? 'Reclaiming…' : 'Reclaim expired'}</Button>
      </div>

      {error && <p className="text-sm text-brand-danger">{error}</p>}
      {msg   && <p className="text-sm text-brand-accent">{msg}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-brand-card border border-gray-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Outstanding (held)</p>
          <HeldAmounts rows={held} />
        </div>
        <div className="bg-brand-card border border-gray-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">WhatsApp pending</p>
          <p className="text-xl font-bold text-brand-accent mt-1">{data?.counts.pending ?? 0}</p>
        </div>
        <div className="bg-brand-card border border-gray-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Purchases pending</p>
          <p className="text-xl font-bold text-brand-accent mt-1">{data?.counts.purchasesPending ?? 0}</p>
        </div>
        <div className="bg-brand-card border border-gray-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Claimed / Reclaimed</p>
          <p className="text-xl font-bold text-brand-accent mt-1">
            {(data?.counts.claimed ?? 0) + (data?.counts.reclaimed ?? 0)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {data?.counts.claimed ?? 0} claimed · {data?.counts.reclaimed ?? 0} reclaimed
          </p>
        </div>
      </div>

      {data?.escrowAddress && (
        <p className="text-xs text-white/60 font-mono">Escrow address: {data.escrowAddress}</p>
      )}

      {unallocated.length > 0 && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
          {unallocated.length} unallocated inbound transfer{unallocated.length === 1 ? '' : 's'} at escrow
          (not linked to a WhatsApp claim or purchase). Review the ledger below.
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-white/90">Inbound ledger</h3>
        <p className="text-xs text-white/60">Vault transfers into this address, classified where possible.</p>
        <Card className="p-0 overflow-hidden">
          <SortableTable
            cols={ledgerCols}
            rows={data?.ledger ?? []}
            initialSort={{ key: 'when', dir: 'desc' }}
            searchable
            searchPlaceholder="Search sender, detail or tx…"
          />
        </Card>
      </div>

      {(data?.purchasesPending?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-white/90">Purchase fulfilment holds</h3>
          <Card className="p-0 overflow-hidden">
            <SortableTable
              cols={purchaseCols}
              rows={data?.purchasesPending ?? []}
              initialSort={{ key: 'when', dir: 'desc' }}
              searchable
              searchPlaceholder="Search consumer or merchant…"
            />
          </Card>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-white/90">WhatsApp claims</h3>
        <p className="text-xs text-white/60">Sends to not-yet-onboarded recipients held until claimed or reclaim expired.</p>
        <Card className="p-0 overflow-hidden">
          <SortableTable
            cols={claimCols}
            rows={data?.claims ?? []}
            initialSort={{ key: 'created', dir: 'desc' }}
            searchable
            searchPlaceholder="Search sender, recipient or tx…"
          />
        </Card>
      </div>
    </div>
  );
}
