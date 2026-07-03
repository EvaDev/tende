import { useMember } from '@/hooks/useMember';

export default function Dashboard() {
  const { member } = useMember();
  if (!member) return null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-accent mb-1">Welcome, {member.displayName ?? member.email}</h1>
      <p className="text-gray-600 mb-6">{member.merchantName} · signed in as {member.role.replace('_', ' ')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-brand-card rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-brand-accent mb-1">Settlement</h3>
          <p className="text-sm text-gray-500">Request a payout, or approve pending requests from your team.</p>
        </div>
        {member.role === 'org_admin' && (
          <div className="bg-brand-card rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-brand-accent mb-1">Team</h3>
            <p className="text-sm text-gray-500">Invite cashiers and store managers, no wallet required.</p>
          </div>
        )}
      </div>
    </div>
  );
}
