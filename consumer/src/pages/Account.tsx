import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Shield, Copy, CheckCheck, IdCard } from 'lucide-react';
import { api } from '@/lib/api';
import { logout } from '@/lib/auth';
import { getEnsParentDomain } from '@/lib/brand';
import BottomNav from '@/components/BottomNav';

interface Profile {
  walletAddress: string; ensSubdomain?: string; countryCode: string;
  displayName?: string | null; mobileNumber?: string | null; hasName?: boolean; hasMobile?: boolean;
  kyc: { levelId: number; levelName: string; allowsUsdSavings: boolean; allowsRemittance: boolean };
}

export default function Account() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied]   = useState(false);

  useEffect(() => { api.get<Profile>('/consumer/me').then(setProfile).catch(() => {}); }, []);

  function copy() {
    if (profile?.walletAddress) {
      navigator.clipboard.writeText(profile.walletAddress);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      <div className="flex flex-col min-h-dvh pb-24">
        <div className="px-6 pt-12 pb-4">
          <h2 className="text-2xl font-bold text-white">Account</h2>
        </div>
        <div className="px-6 space-y-4">
          {/* Identity */}
          <div className="bg-brand-card border border-brand-accent/20 rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-brand-accent/10 flex items-center justify-center text-2xl font-bold text-brand-accent">
                {profile?.ensSubdomain?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div>
                <p className="font-bold text-brand-accent text-lg">@{profile?.ensSubdomain ?? '—'}</p>
                <p className="text-brand-accent/50 text-xs">{profile?.ensSubdomain}.{getEnsParentDomain()}</p>
              </div>
            </div>
            {profile?.walletAddress && (
              <button onClick={copy} className="w-full flex items-center justify-between bg-brand-accent/5 rounded-xl px-4 py-3">
                <span className="font-mono text-xs text-brand-accent/50 truncate">{profile.walletAddress}</span>
                {copied ? <CheckCheck size={16} className="text-brand-accent shrink-0" /> : <Copy size={16} className="text-brand-accent/40 shrink-0" />}
              </button>
            )}
          </div>

          {/* Your details */}
          <div className="bg-brand-card border border-brand-accent/20 rounded-2xl p-5 space-y-3 shadow-sm">
            <div className="flex items-center gap-2">
              <IdCard size={18} className="text-brand-accent" />
              <span className="font-semibold text-brand-accent">Your details</span>
            </div>
            {[
              ['Name',   profile?.displayName  || (profile?.hasName   ? 'On file' : 'Not provided yet')],
              ['Mobile', profile?.mobileNumber || (profile?.hasMobile ? 'On file' : 'Not provided yet')],
              ['Country', profile?.countryCode],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-brand-accent/60">{label}</span>
                <span className="font-medium text-brand-accent">{value}</span>
              </div>
            ))}
          </div>

          {/* KYC */}
          <div className="bg-brand-card border border-brand-accent/20 rounded-2xl p-5 space-y-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-brand-accent" />
              <span className="font-semibold text-brand-accent">Verification Status</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-brand-accent/60">KYC Level</span>
              <span className="bg-brand-accent/10 text-brand-accent px-3 py-1 rounded-full text-xs font-medium">
                {profile?.kyc.levelName ?? '—'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${profile?.kyc.allowsRemittance ? 'bg-brand-accent/10 text-brand-accent' : 'bg-brand-accent/10 text-brand-accent/50'}`}>
                {profile?.kyc.allowsRemittance ? '✓' : '✗'} Remittance
              </div>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${profile?.kyc.allowsUsdSavings ? 'bg-brand-accent/10 text-brand-accent' : 'bg-brand-accent/10 text-brand-accent/50'}`}>
                {profile?.kyc.allowsUsdSavings ? '✓' : '✗'} USD Savings
              </div>
            </div>
          </div>

          <button
            onClick={() => { logout(); navigate('/'); }}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-brand-accent/30 text-brand-accent font-medium active:scale-95 transition-transform"
          >
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </div>
      <BottomNav />
    </>
  );
}
