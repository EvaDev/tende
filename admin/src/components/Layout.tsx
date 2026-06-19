import { NavLink, Outlet } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import MerchantSignup from '@/pages/MerchantSignup';
import {
  LayoutDashboard, Store, Package, Globe, Coins,
  Users, Landmark, Zap, Settings, ScrollText, ClipboardList, Info, Boxes, Gem,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppConfig, useAppName } from '@/hooks/useAppConfig';
import { useRole } from '@/hooks/useRole';
import { useDetectedCountry, flagEmoji } from '@/hooks/useDetectedCountry';

const NAV = [
  { to: '/',           label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/merchants',  label: 'Merchants',  icon: Store },
  { to: '/products',   label: 'Products',   icon: Package },
  { to: '/consumers',  label: 'Consumers',  icon: Users },
  { to: '/countries',  label: 'Countries',  icon: Globe },
  { to: '/currencies', label: 'Currencies', icon: Coins },
  { to: '/treasury',   label: 'Treasury',   icon: Landmark },
  { to: '/paymaster',     label: 'Paymaster',     icon: Zap },
  { to: '/registration',  label: 'Registration',  icon: ClipboardList },
  { to: '/settings',      label: 'Settings',      icon: Settings },
  { to: '/logs',       label: 'Logs',       icon: ScrollText },
  { to: '/assets',     label: 'Assets',     icon: Gem, adminOnly: true },
  { to: '/contracts',  label: 'Contracts',  icon: Boxes, adminOnly: true },
  { to: '/about',      label: 'About',      icon: Info },
];

const NETWORKS: Record<number, { label: string; testnet: boolean }> = {
  1:        { label: 'Ethereum Mainnet', testnet: false },
  11155111: { label: 'Sepolia Testnet',  testnet: true },
};

export default function Layout() {
  const { isConnected, address, chainId, chain } = useAccount();
  const appConfig = useAppConfig();
  const appName = useAppName();
  const { role, resolved } = useRole();
  const { country } = useDetectedCountry();

  const net = chainId ? (NETWORKS[chainId] ?? { label: chain?.name ?? `Chain ${chainId}`, testnet: true }) : null;

  // A connected wallet we don't recognise → merchant onboarding.
  const probing     = isConnected && !resolved;
  const needsSignup = isConnected && resolved && role === 'none';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-brand-accent text-white flex flex-col">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          {appConfig['app.logo'] && (
            <img src={appConfig['app.logo']} alt="logo" className="w-9 h-9 rounded-lg object-contain bg-white/10 p-0.5" />
          )}
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
          {!needsSignup && NAV.filter(item => !item.adminOnly || role === 'admin').map(({ to, label, icon: Icon }) => (
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
              net.testnet ? 'bg-amber-400/15 text-amber-200 border-amber-400/40' : 'bg-emerald-400/15 text-emerald-200 border-emerald-400/40'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${net.testnet ? 'bg-amber-300' : 'bg-emerald-300'}`} />
              {net.label}
            </span>
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
          <div className="[&>div>button]:!text-xs [&>div>button]:!py-1.5 [&>div>button]:!px-3">
            <ConnectButton
              chainStatus="none"
              showBalance={false}
              accountStatus="avatar"
              label={isConnected ? 'Connected' : 'Connect Wallet'}
            />
          </div>
          {!isConnected && (
            <p className="text-xs text-white/40 leading-tight">
              Connect to enable admin actions
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
