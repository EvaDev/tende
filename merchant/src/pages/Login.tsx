import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { claimSeat, loginWithPasskey } from '@/lib/memberAuth';
import { isPasskeySupported } from '@/lib/passkey';
import { getAppName, getAppLogo } from '@/lib/brand';

export default function Login() {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClaim, setShowClaim] = useState(false);
  const [memberId, setMemberId]   = useState('');
  const [email, setEmail]         = useState('');
  const [displayName, setDisplayName] = useState('');

  async function handleLogin() {
    setBusy(true); setError(null);
    try {
      await loginWithPasskey();
      window.dispatchEvent(new Event('member-refresh'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!memberId || !email) return;
    setBusy(true); setError(null);
    try {
      await claimSeat(Number(memberId), email, displayName);
      window.dispatchEvent(new Event('member-refresh'));
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-4">
      <div className="w-full max-w-sm bg-brand-card rounded-2xl shadow-lg p-8">
        <div className="flex flex-col items-center mb-6">
          <img src={getAppLogo()} alt={getAppName()} className="w-14 h-14 object-contain mb-3" />
          <h1 className="text-xl font-bold text-brand-accent">{getAppName()} Merchant</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">Sign in with your passkey — no wallet needed.</p>
        </div>

        {!isPasskeySupported() && (
          <p className="text-sm text-brand-danger mb-4 text-center">
            Your browser doesn't support passkeys. Use a recent Chrome, Safari, or Edge.
          </p>
        )}

        {error && <p className="text-sm text-brand-danger mb-4 text-center">{error}</p>}

        {!showClaim ? (
          <>
            <button
              onClick={handleLogin}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-brand-accent text-white rounded-lg py-2.5 font-medium disabled:opacity-50"
            >
              <KeyRound size={16} /> {busy ? 'Signing in…' : 'Sign in with passkey'}
            </button>
            <button
              onClick={() => setShowClaim(true)}
              className="w-full text-sm text-brand-accent/70 hover:text-brand-accent mt-4"
            >
              First time? Claim your invited seat
            </button>
          </>
        ) : (
          <form onSubmit={handleClaim} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Invite ID</label>
              <input
                type="number" value={memberId} onChange={e => setMemberId(e.target.value)}
                placeholder="From your invite link"
                className="w-full border rounded-lg px-3 py-2 text-sm" required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm" required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Your name</label>
              <input
                type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit" disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-brand-accent text-white rounded-lg py-2.5 font-medium disabled:opacity-50 mt-2"
            >
              <KeyRound size={16} /> {busy ? 'Creating passkey…' : 'Create passkey & activate'}
            </button>
            <button
              type="button" onClick={() => setShowClaim(false)}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
