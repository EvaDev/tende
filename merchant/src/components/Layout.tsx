import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, Landmark, LogOut, ScanLine, Receipt, UserCog, Package, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMember } from '@/hooks/useMember';
import { useMerchantLogo } from '@/hooks/useMerchantLogo';
import Login from '@/pages/Login';
import { getAppName, getAppLogo } from '@/lib/brand';

const NAV = [
  { to: '/',           label: 'Dashboard',     icon: LayoutDashboard },
  { to: '/pos',         label: 'Point of Sale', icon: ScanLine },
  { to: '/products',    label: 'Products',      icon: Package },
  { to: '/sales',       label: 'Sales',         icon: Receipt },
  { to: '/settlement',  label: 'Settlement',    icon: Landmark },
  { to: '/members',     label: 'Team',          icon: Users, orgAdminOnly: true },
  { to: '/my-business', label: 'My Business',   icon: UserCog, orgAdminOnly: true },
  { to: '/about',       label: 'About',         icon: Info },
];

function flagEmoji(countryCode: string): string {
  if (!/^[A-Z]{2}$/i.test(countryCode)) return '';
  return String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map(char => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

export default function Layout() {
  const { member, loading, isOrgAdmin, signOut } = useMember();
  const merchantLogo = useMerchantLogo(!!member);

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
          <img src={getAppLogo()} alt={getAppName()} className="w-9 h-9 object-contain flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xl font-bold tracking-tight truncate">{getAppName()}</span>
              {member.countryCode && (
                <span
                  className="text-2xl leading-none select-none shrink-0"
                  title={member.countryCode}
                  aria-label={`Country ${member.countryCode}`}
                >
                  {flagEmoji(member.countryCode)}
                </span>
              )}
            </div>
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

        <div className="px-3 py-4 border-t border-white/10 space-y-2">
          <div className="w-full">
            {merchantLogo ? (
              <img
                src={merchantLogo}
                alt={member.merchantName}
                className="w-full max-h-24 object-contain"
              />
            ) : (
              <div className="w-full h-16 rounded-lg bg-white/10" />
            )}
            <p className="text-sm font-semibold text-white text-center mt-2 truncate" title={member.merchantName}>
              {member.merchantName}
            </p>
          </div>
          <span className="block text-xs font-medium text-white/70 uppercase tracking-wide">
            {member.role.replace('_', ' ')}
          </span>
          <p className="text-xs text-white/70 truncate">{member.displayName ?? member.email}</p>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-xs text-white/70 hover:text-white pt-1"
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
