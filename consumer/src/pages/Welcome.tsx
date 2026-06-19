import { useNavigate } from 'react-router-dom';
import { getAppName } from '@/lib/brand';

export default function Welcome() {
  const navigate = useNavigate();
  const appName = getAppName();
  return (
    <div className="flex flex-col items-center justify-between min-h-dvh px-8 py-16">
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <div className="w-28 h-28 rounded-3xl bg-brand-card shadow-lg flex items-center justify-center">
          <span className="text-4xl font-bold text-brand-accent">{appName.slice(0, 2)}</span>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-brand-accent">{appName}</h1>
          <p className="text-brand-accent/60 text-lg leading-snug">
            Send money home.<br />Simply.
          </p>
        </div>
      </div>
      <div className="w-full space-y-3">
        <button
          onClick={() => navigate('/register')}
          className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold text-base active:scale-95 transition-transform shadow-sm"
        >
          Create Account
        </button>
        <button
          onClick={() => navigate('/login')}
          className="w-full py-4 rounded-2xl border-2 border-brand-accent text-brand-accent font-semibold text-base active:scale-95 transition-transform"
        >
          Log In
        </button>
      </div>
    </div>
  );
}
