import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fingerprint, AlertCircle } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { getPasskeyAssertion, isPasskeySupported } from '@/lib/passkey';
import { getAppName } from '@/lib/brand';

export default function Login() {
  const navigate    = useNavigate();
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function loginWithPasskey() {
    if (!isPasskeySupported()) { setError('Passkeys are not supported on this device or browser.'); return; }
    setLoading(true); setError('');
    try {
      const { challenge, rpId } = await api.post<{ challenge: string; rpId: string }>('/auth/passkey/login-options', {});
      const assertion           = await getPasskeyAssertion({ challenge, rpId });
      const { token }           = await api.post<{ token: string }>('/auth/passkey/login', assertion);
      setToken(token);
      navigate('/home');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-dvh px-8 py-16 gap-8">
      <div className="flex-1 flex flex-col justify-center gap-8">
        <div>
          <h1 className="text-3xl font-bold text-brand-accent">Welcome back</h1>
          <p className="text-brand-accent/60 mt-1">Sign in with your face or fingerprint.</p>
        </div>
        <button
          onClick={loginWithPasskey} disabled={loading}
          className="w-full flex items-center gap-4 bg-brand-card border-2 border-brand-accent rounded-2xl px-6 py-5 active:scale-95 transition-transform disabled:opacity-50 shadow-sm"
        >
          <div className="w-12 h-12 rounded-xl bg-brand-accent/10 flex items-center justify-center">
            <Fingerprint size={24} className="text-brand-accent" />
          </div>
          <div className="text-left flex-1">
            <p className="font-semibold text-brand-accent">{loading ? 'Verifying…' : 'Sign in with passkey'}</p>
            <p className="text-brand-accent/60 text-sm">Use your device biometrics</p>
          </div>
        </button>
        {error && (
          <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-4 py-3 text-brand-danger text-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
      </div>
      <button onClick={() => navigate('/')} className="text-brand-accent/60 text-sm text-center">
        New to {getAppName()}? <span className="text-brand-accent font-medium">Create an account</span>
      </button>
    </div>
  );
}
