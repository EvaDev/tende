import { NavLink, Outlet } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import MerchantSignup from '@/pages/MerchantSignup';
import {
  LayoutDashboard, Store, Package, Globe, Coins,
  Users, Landmark, Zap, Settings, ScrollText, ClipboardList, Info, Boxes, Gem, BookOpen, BarChart3, UserCog, ShieldCheck, ScanLine, Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppName, useAppLogo, usePublicPages } from '@/hooks/useAppConfig';
import { useRole } from '@/hooks/useRole';
import { useMerchant } from '@/hooks/useMerchant';
import { useDetectedCountry, flagEmoji } from '@/hooks/useDetectedCountry';

const NAV = [
  { to: '/',           label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/my-business', label: 'My Business', icon: UserCog, merchantOnly: true },
  { to: '/pos',         label: 'Point of Sale', icon: ScanLine, merchantOnly: true },
  { to: '/sales',       label: 'Sales', icon: Receipt, merchantOnly: true },
  { to: '/merchants',  label: 'Merchants',  icon: Store },
  { to: '/products',   label: 'Products',   icon: Package },
  { to: '/consumers',  label: 'Consumers',  icon: Users },
  { to: '/countries',  label: 'Countries',  icon: Globe },
  { to: '/currencies', label: 'Currencies', icon: Coins },
  { to: '/treasury',   label: 'Treasury',   icon: Landmark, adminOnly: true },
  { to: '/escrow',     label: 'Escrow',     icon: ShieldCheck, adminOnly: true },
  { to: '/paymaster',     label: 'Paymaster',     icon: Zap, adminOnly: true },
  { to: '/registration',  label: 'Registration',  icon: ClipboardList, adminOnly: true },
  { to: '/settings',      label: 'Settings',      icon: Settings },
  { to: '/logs',       label: 'Logs',       icon: ScrollText },
  { to: '/reports',    label: 'Reports',    icon: BarChart3, adminOnly: true },
  { to: '/assets',     label: 'Assets',     icon: Gem, adminOnly: true },
  { to: '/contracts',  label: 'Contracts',  icon: Boxes, adminOnly: true },
  { to: '/about',      label: 'About',      icon: Info },
  { to: '/docs',       label: 'Docs',       icon: BookOpen },
];

const NETWORKS: Record<number, { label: string; testnet: boolean }> = {
  1:        { label: 'Ethereum Mainnet', testnet: false },
  11155111: { label: 'Sepolia Testnet',  testnet: true },
};

export default function Layout() {
  const { isConnected, address, chainId, chain } = useAccount();
  const appName = useAppName();
  const appLogo = useAppLogo();
  const publicPages = usePublicPages();
  const { role, resolved, error } = useRole();
  const { merchant } = useMerchant(role === 'merchant');
  const { country } = useDetectedCountry();

  const net = chainId ? (NETWORKS[chainId] ?? { label: chain?.name ?? `Chain ${chainId}`, testnet: true }) : null;

  // A connected wallet we don't recognise → merchant onboarding.
  const probing     = isConnected && !resolved;
  // Only treat as a new wallet when the probe SUCCEEDED and said 'none' — a backend
  // error must not masquerade a real admin as a merchant.
  const needsSignup = isConnected && resolved && !error && role === 'none';
  const backendDown = isConnected && resolved && error;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-brand-accent text-white flex flex-col">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <img src={appLogo} alt={appName} className="w-9 h-9 object-contain flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xl font-bold tracking-tight">{appName}</span>
            <span className="block text-xs text-white/50">Admin Console</span>
          </div>
          {country && (
            <span className="text-xl leading-none" title={`Operating country: ${country.name} (${country.currency_code} · USD)`}>
              {flagEmoji(country.code)}
            </span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {/* New wallets onboarding as a merchant don't get the nav until registered. */}
          {!needsSignup && NAV
            .filter(item => {
              if ('merchantOnly' in item && item.merchantOnly) return role === 'merchant';
              // adminOnly pages are hidden unless you're an admin — or the page has
              // been opted into public read-only viewing (see Settings → Public pages).
              if (item.adminOnly) return role === 'admin' || publicPages.includes(item.to.slice(1));
              return true;
            })
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

        {/* Wallet connect at bottom of sidebar */}
        <div className="px-4 py-4 border-t border-white/10 space-y-2">
          {isConnected && net && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
              'bg-white/10 text-white/80 border-white/25'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${net.testnet ? 'bg-white/50' : 'bg-white/90'}`} />
              {net.label}
            </span>
          )}
          {isConnected && role === 'merchant' && merchant && (
            <div className="flex items-center gap-2 mb-1">
              {merchant.icon_id != null && (
                <img
                  src={`/api/admin/icons/${merchant.icon_id}/image`}
                  alt=""
                  className="w-6 h-6 rounded object-contain bg-white/10 p-0.5 flex-shrink-0"
                />
              )}
              <span className="text-sm font-semibold text-white truncate" title={merchant.name}>
                {merchant.name}
              </span>
            </div>
          )}
          {isConnected && role !== 'none' && (
            <span className="block text-xs font-medium text-white/60 uppercase tracking-wide mb-1">
              {role === 'admin' ? 'Admin' : 'Merchant'}
            </span>
          )}
          {isConnected && (
            <p className="text-xs text-white/40 font-mono truncate">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </p>
          )}
          <div className="[&>div>button]:!text-xs [&>div>button]:!py-1.5 [&>div>button]:!px-3 [&>div>button]:!bg-brand-bg [&>div>button]:!text-white [&>div>button:hover]:!opacity-90">
            <ConnectButton
              chainStatus="none"
              showBalance={false}
              accountStatus="avatar"
              label={isConnected ? 'Connected' : 'Connect Wallet'}
            />
          </div>
          {!isConnected && (
            <p className="text-xs text-white/40 leading-tight">
              Connect for full access
            </p>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6 bg-brand-bg">
          {probing ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            </div>
          ) : backendDown ? (
            <div className="max-w-md mx-auto mt-20 rounded-xl border border-brand-danger/30 bg-brand-danger/10 p-6 text-center">
              <h3 className="text-lg font-semibold text-brand-danger">Can’t reach the server</h3>
              <p className="text-sm text-brand-danger/80 mt-2">
                The backend isn’t responding, so your role couldn’t be confirmed. This is a
                server/database issue — not your wallet. Check the API is running, then retry.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-4 py-2 text-sm rounded-lg bg-brand-danger text-white font-medium hover:opacity-90"
              >
                Retry
              </button>
            </div>
          ) : needsSignup ? (
            <MerchantSignup />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
