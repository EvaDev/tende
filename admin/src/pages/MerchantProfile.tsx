import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import IconPicker from '@/components/IconPicker';
import { LogoUpload } from '@/components/LogoUpload';
import { apiFetch, getAuthToken } from '@/lib/api';
import { useRole } from '@/hooks/useRole';
import { useMerchant, refreshMerchant, type MerchantProfile } from '@/hooks/useMerchant';
import { shortAddr } from '@/lib/utils';

// Merchant-facing self-edit of their own business details (PATCH /api/merchants/me).
// Visible in the sidebar only to merchants; admins manage merchants on /merchants.
export default function MerchantProfilePage() {
  const { role, resolved } = useRole();
  const { merchant, loading } = useMerchant(role === 'merchant');

  const [form, setForm] = useState({
    name: '', contactPerson: '', email: '', address: '', settlementType: 'FIAT',
  });
  const [iconId, setIconId] = useState<number | null>(null);
  const [logoSrc, setLogoSrc] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [saved, setSaved]   = useState(false);

  // Hydrate the form once the profile loads.
  useEffect(() => {
    if (!merchant) return;
    setForm({
      name:          merchant.name ?? '',
      contactPerson: merchant.contact_person ?? '',
      email:         merchant.email ?? '',
      address:       merchant.address ?? '',
      settlementType: merchant.settlement_type ?? 'FIAT',
    });
    setIconId(merchant.icon_id ?? null);
    // Load the current logo (authed endpoint → fetch as blob with the token).
    const token = getAuthToken();
    fetch('/api/merchants/me/logo', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = e => setLogoSrc(e.target?.result as string);
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
  }, [merchant]);

  async function uploadLogo(dataUri: string, mimeType: string) {
    await apiFetch('/api/merchants/me/logo', {
      method: 'PUT',
      body: JSON.stringify({ data_base64: dataUri, mime_type: mimeType }),
    });
    setLogoSrc(dataUri);
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    setSaved(false);
  };

  async function save() {
    setErr(''); setSaved(false);
    if (!form.name.trim()) { setErr('Business name is required'); return; }
    setSaving(true);
    try {
      await apiFetch<MerchantProfile>('/api/merchants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name, contactPerson: form.contactPerson, email: form.email,
          address: form.address, settlementType: form.settlementType, iconId,
        }),
      });
      refreshMerchant();   // update the sidebar name/icon
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setSaving(false); }
  }

  if (resolved && role !== 'merchant') {
    return <p className="text-sm text-white/80">This page is for merchant accounts. Connect with your merchant wallet to manage your business.</p>;
  }
  if (loading || !merchant) {
    return <p className="text-sm text-white/80">{loading ? 'Loading your business…' : 'No merchant profile found for this wallet.'}</p>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">My Business</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-accent shadow">
          <span className="w-2 h-2 rounded-full bg-brand-accent" />
          {merchant.verification_status}
        </span>
      </div>
      <p className="text-sm text-white/80 -mt-2">Update the details customers see. Verification status is set by the platform.</p>

      <Card className="space-y-4">
        <CardHeader><CardTitle>Business details</CardTitle></CardHeader>

        <div className="rounded-lg bg-gray-50 border px-4 py-3 text-sm grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase">Wallet</p>
            <p className="font-mono text-gray-800">{shortAddr(merchant.wallet_address)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Country</p>
            <p className="text-gray-800">{merchant.country_code}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Currency</p>
            <p className="text-gray-800">{merchant.currency_code}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div><Label>Business Name *</Label><Input value={form.name} onChange={set('name')} /></div>
          <div><Label>Contact Person</Label><Input value={form.contactPerson} onChange={set('contactPerson')} placeholder="Full name" /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={set('email')} placeholder="you@business.com" /></div>
          <div>
            <Label>Settlement Method</Label>
            <Select value={form.settlementType} onChange={set('settlementType')}>
              <option value="FIAT">Fiat payout (local bank)</option>
              <option value="ONCHAIN">On-chain payout (USDC)</option>
            </Select>
          </div>
          <div className="col-span-2"><Label>Business Address</Label><Input value={form.address} onChange={set('address')} placeholder="Street, city, postal code" /></div>
          <div>
            <Label>Business Logo</Label>
            <LogoUpload currentSrc={logoSrc} onUpload={uploadLogo} size={96} label={form.name || 'Logo'} />
            <p className="text-xs text-gray-400 mt-1">Saves immediately. PNG, JPG or SVG, max 500 KB.</p>
          </div>
          <div>
            <Label>Business Icon</Label>
            <IconPicker value={iconId} onChange={(id) => { setIconId(id); setSaved(false); }} />
          </div>
        </div>

        {err   && <p className="text-sm text-brand-danger">{err}</p>}
        {saved && <p className="text-sm text-brand-accent">Saved.</p>}

        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </Card>
    </div>
  );
}
