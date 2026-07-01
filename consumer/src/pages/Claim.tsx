import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Gift } from 'lucide-react';
import { getClaim, redeemClaim, type ClaimSummary, type RedeemResult } from '@/lib/claim';
import { isLoggedIn } from '@/lib/auth';
import { getAppName } from '@/lib/brand';

export default function Claim() {
  const { secret = '' } = useParams();
  const navigate = useNavigate();
  const [claim, setClaim]     = useState<ClaimSummary | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [phone, setPhone]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState<RedeemResult | null>(null);

  useEffect(() => {
    getClaim(secret).then(setClaim).catch(e => setLoadErr((e as Error).message || 'Claim not found'));
  }, [secret]);

  const rands = claim ? (Number(claim.amount) / 100).toFixed(2) : '';

  async function claimNow() {
    if (phone.replace(/\D/g, '').length < 7) { setError('Enter your phone number with country code'); return; }
    setBusy(true); setError('');
    try {
      setDone(await redeemClaim(secret, phone.trim()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function createAccountAndClaim() {
    // Come back here (logged in) after registration to finish the claim.
    sessionStorage.setItem('claimReturn', `/claim/${secret}`);
    navigate('/register');
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-col items-center justify-center min-h-dvh px-8 gap-6 text-center">{children}</div>
  );

  if (loadErr) return (
    <Shell>
      <AlertCircle size={40} className="text-brand-danger" />
      <p className="text-white">{loadErr}</p>
    </Shell>
  );
  if (!claim) return (
    <Shell><div className="w-8 h-8 border-2 border-white/70 border-t-transparent rounded-full animate-spin" /></Shell>
  );

  if (done) return (
    <Shell>
      <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center"><CheckCircle2 size={48} className="text-white" /></div>
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-white">R{rands} received</h2>
        <p className="text-white">It’s in your {getAppName() || 'iMali'} wallet.</p>
      </div>
      <button onClick={() => navigate('/home')} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">Go to Wallet</button>
    </Shell>
  );

  if (claim.status !== 'pending') return (
    <Shell>
      <AlertCircle size={40} className="text-white" />
      <p className="text-white">This payment has already been {claim.status === 'claimed' ? 'claimed' : 'returned to the sender'}.</p>
    </Shell>
  );
  if (claim.expired) return (
    <Shell>
      <AlertCircle size={40} className="text-white" />
      <p className="text-white">This payment link has expired and the funds were returned to the sender.</p>
    </Shell>
  );

  return (
    <Shell>
      <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center"><Gift size={44} className="text-white" /></div>
      <div className="space-y-1">
        <p className="text-white">You’ve been sent</p>
        <h2 className="text-4xl font-bold text-white">R{rands}</h2>
        <p className="text-white text-sm">to the number ending {claim.phoneHint}</p>
      </div>

      {error && (
        <div className="w-full flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-4 py-3 text-brand-danger text-sm text-left">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {isLoggedIn() ? (
        <div className="w-full space-y-3">
          <input
            value={phone} onChange={e => { setPhone(e.target.value); setError(''); }} type="tel"
            placeholder="Confirm your phone (+27…)"
            className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent text-center outline-none focus:ring-2 focus:ring-brand-accent"
          />
          <button onClick={claimNow} disabled={busy} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 disabled:opacity-40">
            {busy ? 'Claiming…' : `Claim R${rands}`}
          </button>
        </div>
      ) : (
        <button onClick={createAccountAndClaim} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">
          Create your account to claim
        </button>
      )}
      <p className="text-xs text-white">No bank account or app needed — secured by your phone’s biometrics.</p>
    </Shell>
  );
}
