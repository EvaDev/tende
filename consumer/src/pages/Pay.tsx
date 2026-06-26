import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, AlertCircle, CheckCircle2, Fingerprint, AtSign } from 'lucide-react';
import { prepareTransfer, signAndSubmitTransfer, type PreparedTransfer, type TransferResult } from '@/lib/pay';
import { isPasskeySupported } from '@/lib/passkey';
import { getEnsParentDomain } from '@/lib/brand';

type Step = 'form' | 'confirm' | 'success';

// Pilot is single-currency cash (ZAR). The recipient must be a verified account
// (@tag or 0x wallet); unverified recipients go through escrow (not yet built).
const CURRENCY = 'ZAR';

export default function Pay() {
  const navigate = useNavigate();
  const [step, setStep]       = useState<Step>('form');
  const [to, setTo]           = useState('');
  const [amount, setAmount]   = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [result, setResult]     = useState<TransferResult | null>(null);

  function set<T>(setter: (v: T) => void, v: T) { setter(v); setError(''); }

  async function goConfirm() {
    if (!to.trim()) { setError('Enter a recipient @tag or 0x address'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (!isPasskeySupported()) { setError('Passkeys are not supported on this device or browser.'); return; }

    setLoading(true); setError('');
    try {
      const p = await prepareTransfer({ to: to.trim(), amount, currency: CURRENCY });
      setPrepared(p);
      setStep('confirm');
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setLoading(false);
    }
  }

  async function confirmAndSign() {
    if (!prepared) return;
    setLoading(true); setError('');
    try {
      const r = await signAndSubmitTransfer(prepared);
      setResult(r);
      setStep('success');
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setLoading(false);
    }
  }

  // Map backend error codes / messages to consumer-friendly copy.
  function friendly(msg: string): string {
    if (msg.includes('RECIPIENT_UNVERIFIED') || msg.includes('not verified')) return 'That recipient hasn’t verified their account yet. Ask them to finish onboarding first.';
    if (msg.includes('SENDER_KYC') || msg.includes('not yet verified')) return 'Your account isn’t verified yet. Complete identity verification to send money.';
    if (msg.includes('INSUFFICIENT_BALANCE') || msg.includes('Insufficient')) return 'You don’t have enough balance for this transfer.';
    if (msg.includes('No account found')) return msg;
    if (msg.includes('cancelled')) return 'Sign-in was cancelled. Try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  const shortTo = prepared ? `${prepared.to.slice(0, 6)}…${prepared.to.slice(-4)}` : '';

  if (step === 'success' && result) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-8 gap-8">
        <div className="w-24 h-24 rounded-full bg-brand-accent/10 flex items-center justify-center">
          <CheckCircle2 size={48} className="text-brand-accent" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-brand-accent">Sent</h2>
          <p className="text-brand-accent/60">
            R{parseFloat(result.amount).toFixed(2)} sent to {to.startsWith('@') || !to.startsWith('0x') ? to : shortTo}
          </p>
          <a
            href={`https://sepolia.etherscan.io/tx/${result.txHash}`} target="_blank" rel="noreferrer"
            className="text-brand-accent text-xs font-mono underline break-all"
          >
            {result.txHash.slice(0, 10)}…{result.txHash.slice(-8)}
          </a>
        </div>
        <button onClick={() => navigate('/home')} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh pb-8">
      <div className="px-6 pt-10 pb-4 flex items-center gap-4">
        <button onClick={() => step === 'confirm' ? setStep('form') : navigate(-1)} className="text-brand-accent/60">←</button>
        <h2 className="text-xl font-bold text-brand-accent">{step === 'confirm' ? 'Confirm Payment' : 'Pay Someone'}</h2>
      </div>

      <div className="flex-1 px-6 space-y-4">
        {error && (
          <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-4 py-3 text-brand-danger text-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {step === 'form' && (
          <>
            <div className="space-y-1">
              <label className="block text-xs text-brand-accent/60 uppercase tracking-wide font-medium">Recipient</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-accent/50"><AtSign size={16} /></span>
                <input
                  value={to} onChange={e => set(setTo, e.target.value)}
                  placeholder="@tag or 0x address"
                  className="w-full bg-brand-card border border-brand-accent/20 rounded-xl pl-10 pr-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent placeholder-brand-accent/30"
                />
              </div>
              <p className="text-xs text-brand-accent/40 px-1">Send to another {getEnsParentDomain() || 'wallet'} account by tag, or paste a wallet address.</p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-brand-accent/60 uppercase tracking-wide font-medium">Amount (ZAR)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-accent/50 font-semibold">R</span>
                <input
                  type="number" inputMode="decimal" value={amount}
                  onChange={e => set(setAmount, e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-brand-card border border-brand-accent/20 rounded-xl pl-8 pr-4 py-4 text-xl font-semibold text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
                />
              </div>
            </div>

            <button onClick={goConfirm} disabled={loading} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 disabled:opacity-40">
              {loading ? 'Checking…' : <>Continue <ChevronRight size={16} className="inline" /></>}
            </button>
          </>
        )}

        {step === 'confirm' && prepared && (
          <>
            <div className="bg-brand-card border border-brand-accent/20 rounded-2xl divide-y divide-brand-accent/10">
              {[
                ['To', to.startsWith('0x') ? shortTo : to],
                ['Wallet', shortTo],
                ['Amount', `R${parseFloat(prepared.amount).toFixed(2)}`],
                ['Currency', prepared.currency],
                ['Network fee', 'Free (sponsored)'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-brand-accent/60">{label}</span>
                  <span className="font-medium text-brand-accent">{value}</span>
                </div>
              ))}
            </div>
            <div className="bg-brand-accent/5 border border-brand-accent/20 rounded-xl px-4 py-3 text-xs text-brand-accent/70">
              You’ll approve this payment with your face or fingerprint. Your money moves directly from your own wallet — we never hold it.
            </div>
            <button onClick={confirmAndSign} disabled={loading} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 disabled:opacity-40">
              <span className="flex items-center justify-center gap-2">
                <Fingerprint size={18} />
                {loading ? 'Confirming…' : 'Approve & Send'}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
