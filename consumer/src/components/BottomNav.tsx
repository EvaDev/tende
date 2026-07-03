import { Home, ShoppingBag, Clock, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  { path: '/home',    label: 'Home',    Icon: Home        },
  { path: '/buy',     label: 'Buy',     Icon: ShoppingBag },
  { path: '/history', label: 'History', Icon: Clock       },
  { path: '/account', label: 'Account', Icon: User        },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate     = useNavigate();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-brand-bg border-t border-brand-text/10 safe-bottom z-50 shadow-lg">
      <div className="flex">
        {tabs.map(({ path, label, Icon }) => {
          const active = pathname.startsWith(path);
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                active ? 'text-brand-text' : 'text-brand-text/60'
              }`}
            >
              <span
                className={`flex items-center justify-center rounded-full px-3 py-1 transition-colors ${
                  active ? 'bg-brand-accent/30' : ''
                }`}
              >
                <Icon size={20} />
              </span>
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
