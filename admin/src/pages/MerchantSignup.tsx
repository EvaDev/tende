import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useSignMessage } from 'wagmi';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { setAuthToken } from '@/lib/api';
import { refreshRole } from '@/hooks/useRole';
import { useDetectedCountry, flagEmoji } from '@/hooks/useDetectedCountry';
import { shortAddr } from '@/lib/utils';

// Self-service merchant onboarding, shown when a new (unknown) wallet connects.
// KYB details are collected but not verified yet (status stays PENDING).
export default function MerchantSignup() {
  const navigate = useNavigate();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { country, countries } = useDetectedCountry();

  const [form, setForm] = useState({
    name: '', contactPerson: '', email: '', address: '', settlementType: 'FIAT', countryCode: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  // Default the country to the detected one once it loads.
  useEffect(() => { if (country && !form.countryCode) setForm(f => ({ ...f, countryCode: country.code })); }, [country]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setErr('');
    if (!form.name)        { setErr('Business name is required'); return; }
    if (!form.countryCode) { setErr('Select a country'); return; }
    setBusy(true);
    try {
      const addr   = address!.toLowerCase();
      // Prove wallet ownership: sign a server nonce, then register.
      const nonce  = await fetch(`/api/auth/nonce?wallet=${addr}`).then(r => r.json());
      const signature = await signMessageAsync({ message: nonce.message });
      const res = await fetch('/api/merchants/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: addr, signature,
          name: form.name, email: form.email, address: form.address,
          contactPerson: form.contactPerson, settlementType: form.settlementType, countryCode: form.countryCode,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Registration failed');

      setAuthToken(body.token);
      localStorage.setItem('auth_token', body.token);
      refreshRole();            // flip role → merchant so the app opens up
      navigate('/products');    // invite them to list products
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold text-brand-accent">Become a merchant</h2>
      <p className="text-sm text-gray-600 -mt-2">
        Welcome! We don't recognise this wallet yet. Register your business below to start accepting payments.
      </p>

      <Card className="space-y-4">
        <CardHeader><CardTitle>Business details</CardTitle></CardHeader>

        <div className="rounded-lg bg-gray-50 border px-4 py-3 text-sm flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase">Connected wallet</p>
            <p className="font-mono text-gray-800">{address ? shortAddr(address) : '—'}</p>
          </div>
          {country && <span className="text-sm text-gray-600">{flagEmoji(country.code)} {country.name}</span>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div><Label>Business Name *</Label><Input value={form.name} onChange={set('name')} placeholder="e.g. Mama's Spaza" /></div>
          <div><Label>Contact Person</Label><Input value={form.contactPerson} onChange={set('contactPerson')} placeholder="Full name" /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={set('email')} placeholder="you@business.com" /></div>
          <div>
            <Label>Country *</Label>
            <Select value={form.countryCode} onChange={set('countryCode')}>
              <option value="">Select…</option>
              {countries.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </Select>
          </div>
          <div className="col-span-2"><Label>Business Address</Label><Input value={form.address} onChange={set('address')} placeholder="Street, city, postal code" /></div>
          <div className="col-span-2">
            <Label>Settlement Method</Label>
            <Select value={form.settlementType} onChange={set('settlementType')}>
              <option value="FIAT">Fiat payout (local bank)</option>
              <option value="ONCHAIN">On-chain payout (USDC)</option>
            </Select>
          </div>
        </div>

        <p className="text-xs text-gray-400">
          Identity/KYB verification is not performed at this stage — your status will be “Pending” until reviewed.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}

        <Button onClick={submit} disabled={busy}>
          {busy ? 'Signing & registering…' : 'Register & list products'}
        </Button>
      </Card>
    </div>
  );
}
