import { useEffect, useState } from 'react';
import { Copy, CheckCheck, UserPlus } from 'lucide-react';
import { api, apiFetch, AuthError } from '@/lib/api';
import { statusColor } from '@/lib/utils';
import { RequireOrgAdmin } from '@/components/RequireOrgAdmin';

interface MemberRow {
  id: number; email: string | null; display_name: string | null;
  role: string; status: string; store_scope: string | null; created_at: string;
}

interface StoreOption { storeCode: string; name: string; countryCode: string; currencyCode: string }

function CopyInviteId({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(String(id));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-brand-accent hover:underline"
      title="Copy Invite ID"
    >
      {id}
      {copied ? <CheckCheck size={14} /> : <Copy size={14} className="opacity-50" />}
    </button>
  );
}

function MembersTable({ rows, showInviteId }: { rows: MemberRow[]; showInviteId?: boolean }) {
  if (!rows.length) return null;
  return (
    <table className="w-full text-sm bg-brand-card rounded-xl shadow-sm overflow-hidden">
      <thead className="bg-brand-accent/5 text-brand-accent text-left">
        <tr>
          {showInviteId && <th className="px-4 py-2">Invite ID</th>}
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2">Email</th>
          <th className="px-4 py-2">Role</th>
          <th className="px-4 py-2">Store</th>
          <th className="px-4 py-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(m => (
          <tr key={m.id} className="border-t">
            {showInviteId && (
              <td className="px-4 py-2">
                {m.status === 'invited' ? <CopyInviteId id={m.id} /> : <span className="text-gray-400">—</span>}
              </td>
            )}
            <td className="px-4 py-2">{m.display_name ?? '—'}</td>
            <td className="px-4 py-2">{m.email}</td>
            <td className="px-4 py-2">{m.role.replace('_', ' ')}</td>
            <td className="px-4 py-2 text-xs text-gray-600">{m.store_scope ?? 'All'}</td>
            <td className="px-4 py-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(m.status)}`}>{m.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MembersInner() {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [stores, setStores]     = useState<StoreOption[]>([]);
  const [email, setEmail]     = useState('');
  const [name, setName]       = useState('');
  const [role, setRole]       = useState('cashier');
  const [storeScope, setStoreScope] = useState('');
  const [invited, setInvited] = useState<{ memberId: number } | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [existingSeat, setExistingSeat] = useState<{ memberId: number; status: string } | null>(null);
  const [busy, setBusy]       = useState(false);

  async function loadMembers() {
    try {
      setMembers(await api.get<MemberRow[]>('/api/member-auth/members'));
    } catch (err) {
      if (!(err instanceof AuthError)) setError((err as Error).message);
    }
  }

  useEffect(() => {
    loadMembers();
    apiFetch<{ storeCode: string; name: string; countryCode: string; currencyCode: string }[]>('/api/merchant/me/stores')
      .then(rows => setStores(rows.map(s => ({
        storeCode: s.storeCode, name: s.name, countryCode: s.countryCode, currencyCode: s.currencyCode,
      }))))
      .catch(() => {});
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInvited(null);
    setExistingSeat(null);
    try {
      const res = await api.post<{ memberId: number }>('/api/member-auth/invite', {
        email, displayName: name, role,
        storeScope: storeScope.trim() || undefined,
      });
      setInvited(res);
      await loadMembers();
      setEmail(''); setName(''); setStoreScope('');
    } catch (err) {
      const body = err as Error & { memberId?: number; status?: string };
      setError(body.message);
      if (body.memberId) setExistingSeat({ memberId: body.memberId, status: body.status ?? 'unknown' });
    } finally {
      setBusy(false);
    }
  }

  const showStorePick = role === 'cashier' || role === 'store_manager';
  const pending = members?.filter(m => m.status === 'invited') ?? [];
  const active  = members?.filter(m => m.status !== 'invited') ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Team</h1>
        <p className="text-white/80">
          Invite operators — they claim their seat with a passkey. Assign a store so cashiers only see that location in POS.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Pending invites</h2>
          <p className="text-xs text-white/70">
            Share the <strong>Invite ID</strong> with each person — they enter it on the login screen under &quot;Claim your invited seat&quot;.
          </p>
          <MembersTable rows={pending} showInviteId />
        </div>
      )}

      <form onSubmit={handleInvite} className="bg-brand-card rounded-xl p-5 shadow-sm space-y-3">
        <h3 className="font-semibold text-brand-accent flex items-center gap-2"><UserPlus size={16} /> Invite an operator</h3>
        {error && (
          <div className="text-sm text-brand-danger space-y-1">
            <p>{error}</p>
            {existingSeat?.status === 'invited' && (
              <p className="text-brand-accent">
                Re-share Invite ID: <CopyInviteId id={existingSeat.memberId} />
              </p>
            )}
            {existingSeat?.status === 'active' && (
              <p className="text-brand-accent/70 text-xs">
                This person is already active — they sign in with passkey, no new invite needed.
              </p>
            )}
          </div>
        )}
        {invited && (
          <div className="text-sm text-brand-accent bg-brand-accent/5 border border-brand-accent/20 rounded-lg px-3 py-2 space-y-1">
            <p>Invited — share this <strong>Invite ID</strong>:</p>
            <CopyInviteId id={invited.memberId} />
            <p className="text-xs text-brand-accent/70">
              Merchant app → Claim your invited seat → ID + email + passkey.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <input
            type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm col-span-2 sm:col-span-1" required
          />
          <input
            type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm col-span-2 sm:col-span-1"
          />
          <select value={role} onChange={e => setRole(e.target.value)} className="border rounded-lg px-3 py-2 text-sm col-span-2">
            <option value="cashier">Cashier</option>
            <option value="store_manager">Store manager</option>
            <option value="org_admin">Org admin (head office)</option>
          </select>
          {showStorePick && (
            <select
              value={storeScope}
              onChange={e => setStoreScope(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm col-span-2"
            >
              <option value="">All stores (head office access)</option>
              {stores.map(s => (
                <option key={s.storeCode} value={s.storeCode}>
                  {s.name} ({s.storeCode}) — {s.countryCode} / {s.currencyCode}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-xs text-gray-500">Use a different email per operator — you can&apos;t invite the same address twice.</p>
        <button
          type="submit" disabled={busy}
          className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Inviting…' : 'Send invite'}
        </button>
      </form>

      {active.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Active team</h2>
          <MembersTable rows={active} />
        </div>
      )}

      {members && members.length === 0 && (
        <p className="text-sm text-white/70">No team members yet.</p>
      )}
    </div>
  );
}

export default function Members() {
  return <RequireOrgAdmin><MembersInner /></RequireOrgAdmin>;
}
