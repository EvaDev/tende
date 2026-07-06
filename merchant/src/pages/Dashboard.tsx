import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMember } from '@/hooks/useMember';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';

interface DashboardSummary {
  sales: { total: string; currency: string; transactions: number; tillsActive: number };
  changeVouchers: { issued: number; total: string; currency: string };
}

function StatCard({ to, label, value }: { to: string; label: string; value: string }) {
  return (
    <Link to={to} className="bg-brand-accent text-white rounded-xl p-4 active:scale-[0.98] transition-transform">
      <p className="text-xs uppercase tracking-wide text-white/70">{label}</p>
      <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
    </Link>
  );
}

export default function Dashboard() {
  const { member } = useMember();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    apiFetch<DashboardSummary>('/api/merchant/me/dashboard-summary')
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  if (!member) return null;

  const sales = summary?.sales;
  const cv = summary?.changeVouchers;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Welcome, {member.displayName ?? member.email}</h1>
        <p className="text-white/80">{member.merchantName} · signed in as {member.role.replace('_', ' ')}</p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            to="/sales"
            label="Total sales"
            value={sales ? formatMoney(sales.total, sales.currency) : '—'}
          />
          <StatCard
            to="/sales"
            label="Transactions"
            value={sales?.transactions.toLocaleString() ?? '—'}
          />
          <StatCard
            to="/sales"
            label="Tills active"
            value={sales?.tillsActive.toLocaleString() ?? '—'}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            to="/pos"
            label="Change vouchers"
            value={cv?.issued.toLocaleString() ?? '—'}
          />
          <StatCard
            to="/pos"
            label="Change vouchers total"
            value={cv ? formatMoney(cv.total, cv.currency) : '—'}
          />
        </div>
      </div>

      {member.role === 'org_admin' && (
        <Link to="/members" className="block bg-brand-card rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow max-w-md">
          <h3 className="font-semibold text-brand-accent mb-1">Team</h3>
          <p className="text-sm text-gray-500">Invite cashiers and store managers, no wallet required.</p>
        </Link>
      )}
    </div>
  );
}
