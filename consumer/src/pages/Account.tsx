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
      <div className="flex flex-col min-h-dvh pb-24 px-6 pt-14">
        <h1 className="text-3xl font-bold text-white mb-6">Account</h1>
        <div className="space-y-3">
          {/* Identity */}
          <div className="bg-brand-accent rounded-2xl p-5 space-y-4 text-white">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center text-2xl font-bold text-white">
                {profile?.ensSubdomain?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div>
                <p className="font-bold text-lg text-white">@{profile?.ensSubdomain ?? '—'}</p>
                <p className="text-white/70 text-xs">{profile?.ensSubdomain}.{getEnsParentDomain()}</p>
              </div>
            </div>
            {profile?.walletAddress && (
              <button onClick={copy} className="w-full flex items-center justify-between bg-white/10 rounded-xl px-4 py-3">
                <span className="font-mono text-xs text-white/70 truncate">{profile.walletAddress}</span>
                {copied ? <CheckCheck size={16} className="text-white shrink-0" /> : <Copy size={16} className="text-white/60 shrink-0" />}
              </button>
            )}
          </div>

          {/* Your details */}
          <div className="bg-brand-accent rounded-2xl p-5 space-y-3 text-white">
            <div className="flex items-center gap-2">
              <IdCard size={18} className="text-white" />
              <span className="font-semibold text-white">Your details</span>
            </div>
            {[
              ['Name',   profile?.displayName  || (profile?.hasName   ? 'On file' : 'Not provided yet')],
              ['Mobile', profile?.mobileNumber || (profile?.hasMobile ? 'On file' : 'Not provided yet')],
              ['Country', profile?.countryCode],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-white/70">{label}</span>
                <span className="font-medium text-white">{value}</span>
              </div>
            ))}
          </div>

          {/* KYC */}
          <div className="bg-brand-accent rounded-2xl p-5 space-y-3 text-white">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-white" />
              <span className="font-semibold text-white">Verification Status</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">KYC Level</span>
              <span className="bg-white/15 text-white px-3 py-1 rounded-full text-xs font-medium">
                {profile?.kyc.levelName ?? '—'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${profile?.kyc.allowsRemittance ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}>
                {profile?.kyc.allowsRemittance ? '✓' : '✗'} Remittance
              </div>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${profile?.kyc.allowsUsdSavings ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}>
                {profile?.kyc.allowsUsdSavings ? '✓' : '✗'} USD Savings
              </div>
            </div>
          </div>

          <button
            onClick={() => { logout(); navigate('/'); }}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-white/30 text-white font-medium active:scale-95 transition-transform"
          >
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </div>
      <BottomNav />
    </>
  );
}
