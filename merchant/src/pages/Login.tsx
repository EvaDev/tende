import { useEffect, useState } from 'react';
import { KeyRound, Wallet } from 'lucide-react';
import { claimSeat, loginWithPasskey } from '@/lib/memberAuth';
import { isPasskeySupported } from '@/lib/passkey';
import { getAppName, getAppLogo } from '@/lib/brand';
import { connectWallet, hasInjectedWallet, onWalletAccountsChanged, shortAddr, signMessage } from '@/lib/wallet';
import { useDetectedCountry } from '@/hooks/useDetectedCountry';
import IconPicker from '@/components/IconPicker';

type Mode = 'login' | 'claim' | 'register';

export default function Login() {
  const { country, countries } = useDetectedCountry();
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Claim invite (staff)
  const [memberId, setMemberId] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Self-service owner registration
  const [wallet, setWallet] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', contactPerson: '', email: '', address: '',
    settlementType: 'FIAT', countryCode: '',
  });
  const [iconId, setIconId] = useState<number | null>(null);

  useEffect(() => {
    if (country && !form.countryCode) setForm(f => ({ ...f, countryCode: country.code }));
  }, [country]);

  // Stay aligned with MetaMask's active account while on the register form.
  useEffect(() => {
    if (mode !== 'register') return;
    return onWalletAccountsChanged(addr => {
      setWallet(addr);
      if (addr) setError(null);
    });
  }, [mode]);

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

  async function handleConnect(forcePicker = false) {
    setError(null);
    try {
      if (forcePicker) setWallet(null); // clear stale authorized account while re-picking
      setWallet(await connectWallet({ forceAccountPicker: forcePicker }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet) { setError('Connect your wallet first'); return; }
    if (!form.name.trim()) { setError('Business name is required'); return; }
    if (!form.countryCode) { setError('Select a country'); return; }
    if (!form.email.trim()) { setError('Email is required so you can claim your owner seat'); return; }
    if (!isPasskeySupported()) {
      setError('Your browser isn’t supported for signup. Use a recent Chrome, Safari, or Edge.');
      return;
    }

    setBusy(true); setError(null);
    try {
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${wallet}`);
      const nonce = await nonceRes.json() as { message?: string; error?: string };
      if (!nonceRes.ok || !nonce.message) throw new Error(nonce.error || 'Could not get sign-in challenge');

      const signature = await signMessage(wallet, nonce.message);
      const regRes = await fetch('/api/merchants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet,
          signature,
          name: form.name.trim(),
          email: form.email.trim(),
          address: form.address.trim() || null,
          contactPerson: form.contactPerson.trim() || null,
          settlementType: form.settlementType,
          countryCode: form.countryCode,
          iconId,
        }),
      });
      const body = await regRes.json() as {
        error?: string; code?: string; memberId?: number;
      };
      if (!regRes.ok) {
        if (body.code === 'ALREADY_REGISTERED') {
          throw new Error('This wallet is already registered — sign in with your passkey instead.');
        }
        throw new Error(body.error || 'Registration failed');
      }
      if (!body.memberId) throw new Error('Registration succeeded but no owner seat was created');

      // Immediately create the owner passkey and enter the merchant app.
      await claimSeat(
        body.memberId,
        form.email.trim(),
        form.contactPerson.trim() || form.name.trim(),
      );
      window.dispatchEvent(new Event('member-refresh'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: ev.target.value }));

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-4 py-8">
      <div className="w-full max-w-md bg-brand-card rounded-2xl shadow-lg p-8">
        <div className="flex flex-col items-center mb-6">
          <img src={getAppLogo()} alt={getAppName()} className="w-14 h-14 object-contain mb-3" />
          <h1 className="text-xl font-bold text-brand-accent">{getAppName()} Merchant</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            {mode === 'register'
              ? 'Register your business with your owner wallet.'
              : 'Operators sign in with a passkey — no wallet needed day to day.'}
          </p>
        </div>

        {!isPasskeySupported() && (
          <p className="text-sm text-brand-danger mb-4 text-center">
            Your browser doesn't support passkeys. Use a recent Chrome, Safari, or Edge.
          </p>
        )}

        {error && <p className="text-sm text-brand-danger mb-4 text-center">{error}</p>}

        {mode === 'login' && (
          <>
            <button
              onClick={handleLogin}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-brand-accent text-white rounded-lg py-2.5 font-medium disabled:opacity-50"
            >
              <KeyRound size={16} /> {busy ? 'Signing in…' : 'Sign in with passkey'}
            </button>
            <button
              onClick={() => { setMode('register'); setError(null); }}
              className="w-full flex items-center justify-center gap-2 border border-brand-accent text-brand-accent rounded-lg py-2.5 font-medium mt-3"
            >
              <Wallet size={16} /> Register as a merchant
            </button>
            <button
              onClick={() => { setMode('claim'); setError(null); }}
              className="w-full text-sm text-brand-accent/70 hover:text-brand-accent mt-4"
            >
              Invited to a team? Claim your seat
            </button>
          </>
        )}

        {mode === 'claim' && (
          <form onSubmit={handleClaim} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Invite ID</label>
              <input
                type="number" value={memberId} onChange={e => setMemberId(e.target.value)}
                placeholder="From your invite"
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
            <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-gray-500 hover:text-gray-700">
              Back to sign in
            </button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="rounded-lg bg-gray-50 border px-3 py-3 text-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Owner wallet</p>
              {wallet ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-gray-800">{shortAddr(wallet)}</span>
                  <button
                    type="button"
                    onClick={() => handleConnect(true)}
                    className="text-xs text-brand-accent underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleConnect(true)}
                  disabled={!hasInjectedWallet()}
                  className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white rounded-lg py-2 font-medium disabled:opacity-50"
                >
                  <Wallet size={16} /> {hasInjectedWallet() ? 'Connect wallet' : 'No wallet detected'}
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Business name *</label>
              <input value={form.name} onChange={set('name')} required
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Mama's Spaza" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Your name</label>
              <input value={form.contactPerson} onChange={set('contactPerson')}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Contact person" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={set('email')} required
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="you@business.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Country *</label>
              <select value={form.countryCode} onChange={set('countryCode')} required
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select…</option>
                {countries.map(c => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Business address</label>
              <input value={form.address} onChange={set('address')}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Street, city" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Settlement</label>
              <select value={form.settlementType} onChange={set('settlementType')}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="FIAT">Fiat payout (local bank)</option>
                <option value="ONCHAIN">On-chain payout (USDC)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Business icon</label>
              <IconPicker value={iconId} onChange={setIconId} />
            </div>

            <p className="text-xs text-gray-500">
              You’ll sign once in your wallet to prove ownership. KYB stays pending until reviewed.
            </p>

            <button
              type="submit"
              disabled={busy || !wallet}
              className="w-full flex items-center justify-center gap-2 bg-brand-accent text-white rounded-lg py-2.5 font-medium disabled:opacity-50"
            >
              <KeyRound size={16} />
              {busy ? 'Registering…' : 'Register'}
            </button>
            <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-gray-500 hover:text-gray-700">
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
