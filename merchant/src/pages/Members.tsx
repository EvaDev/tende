import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { statusColor } from '@/lib/utils';
import { RequireOrgAdmin } from '@/components/RequireOrgAdmin';

interface MemberRow {
  id: number; email: string | null; display_name: string | null;
  role: string; status: string; created_at: string;
}

function MembersInner() {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [email, setEmail]     = useState('');
  const [name, setName]       = useState('');
  const [role, setRole]       = useState('cashier');
  const [invited, setInvited] = useState<{ memberId: number } | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  async function loadMembers() {
    try {
      setMembers(await api.get<MemberRow[]>('/api/member-auth/members'));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { loadMembers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInvited(null);
    try {
      const res = await api.post<{ memberId: number }>('/api/member-auth/invite', { email, displayName: name, role });
      setInvited(res);
      await loadMembers();
      setEmail(''); setName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-brand-accent mb-1">Team</h1>
      <p className="text-gray-600 mb-6">Invite operators — they claim their seat with their own passkey, no wallet needed.</p>

      <form onSubmit={handleInvite} className="bg-brand-card rounded-xl p-5 shadow-sm space-y-3 mb-6">
        <h3 className="font-semibold text-brand-accent flex items-center gap-2"><UserPlus size={16} /> Invite an operator</h3>
        {error && <p className="text-sm text-brand-danger">{error}</p>}
        {invited && (
          <p className="text-sm text-brand-accent">
            Invited — share this Invite ID with them: <span className="font-mono font-semibold">{invited.memberId}</span>
          </p>
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
        </div>
        <button
          type="submit" disabled={busy}
          className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Inviting…' : 'Send invite'}
        </button>
      </form>

      {members && members.length > 0 && (
        <table className="w-full text-sm bg-brand-card rounded-xl shadow-sm overflow-hidden">
          <thead className="bg-brand-accent/5 text-brand-accent text-left">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} className="border-t">
                <td className="px-4 py-2">{m.display_name ?? '—'}</td>
                <td className="px-4 py-2">{m.email}</td>
                <td className="px-4 py-2">{m.role.replace('_', ' ')}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(m.status)}`}>{m.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Members() {
  return <RequireOrgAdmin><MembersInner /></RequireOrgAdmin>;
}
