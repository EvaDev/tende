import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, Landmark, LogOut, ScanLine, Receipt, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMember } from '@/hooks/useMember';
import Login from '@/pages/Login';
import logoUrl from '@/assets/iMali_icon.png';

const NAV = [
  { to: '/',           label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/pos',         label: 'Point of Sale', icon: ScanLine },
  { to: '/sales',       label: 'Sales',         icon: Receipt },
  { to: '/settlement',  label: 'Settlement',    icon: Landmark },
  { to: '/members',     label: 'Team',          icon: Users, orgAdminOnly: true },
  { to: '/my-business', label: 'My Business',   icon: UserCog, orgAdminOnly: true },
];

export default function Layout() {
  const { member, loading, isOrgAdmin, signOut } = useMember();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-brand-bg">
        <div className="w-8 h-8 border-2 border-brand-accent/40 border-t-brand-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!member) return <Login />;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 flex-shrink-0 bg-brand-accent text-white flex flex-col">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <img src={logoUrl} alt="iMali" className="w-9 h-9 object-contain flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xl font-bold tracking-tight">iMali</span>
            <span className="block text-xs text-white/50">Merchant</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {NAV
            .filter(item => !item.orgAdminOnly || isOrgAdmin)
            .map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-white/10 space-y-2">
          <div className="text-sm font-semibold text-white truncate" title={member.merchantName}>
            {member.merchantName}
          </div>
          <span className="block text-xs font-medium text-white/60 uppercase tracking-wide">
            {member.role.replace('_', ' ')}
          </span>
          <p className="text-xs text-white/40 truncate">{member.displayName ?? member.email}</p>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-xs text-white/60 hover:text-white pt-1"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6 bg-brand-bg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
