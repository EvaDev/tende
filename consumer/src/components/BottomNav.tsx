import { Home, Send, Clock, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  { path: '/home',    label: 'Home',    Icon: Home  },
  { path: '/send',    label: 'Send',    Icon: Send  },
  { path: '/history', label: 'History', Icon: Clock },
  { path: '/account', label: 'Account', Icon: User  },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate     = useNavigate();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-brand-card border-t border-brand-accent/20 safe-bottom z-50 shadow-lg">
      <div className="flex">
        {tabs.map(({ path, label, Icon }) => {
          const active = pathname.startsWith(path);
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
                active ? 'text-brand-accent' : 'text-brand-accent/40'
              }`}
            >
              <Icon size={20} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
