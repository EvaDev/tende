import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

type State = 'idle' | 'loading' | 'success' | 'error';

function formatVoucher(v: string) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1-');
}

export default function TopUp() {
  const navigate = useNavigate();
  const [code, setCode]     = useState('');
  const [state, setState]   = useState<State>('idle');
  const [amount, setAmount] = useState('');
  const [error, setError]   = useState('');

  async function redeem() {
    const raw = code.replace(/\D/g, '');
    if (raw.length !== 16) { setError('Enter a valid 16-digit code'); return; }
    setState('loading'); setError('');
    try {
      const res = await api.post<{ amount: string }>('/consumer/redeem-voucher', { code: raw });
      setAmount(res.amount); setState('success');
    } catch (e) {
      setError((e as Error).message); setState('error');
    }
  }

  if (state === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-8 gap-8">
        <div className="w-24 h-24 rounded-full bg-brand-accent/10 flex items-center justify-center">
          <CheckCircle2 size={48} className="text-brand-accent" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-brand-accent">R{amount} credited!</h2>
          <p className="text-brand-accent/60">Your wallet has been topped up.</p>
        </div>
        <button onClick={() => navigate('/home')} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">Back to Home</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh px-6 py-12 gap-8">
      <button onClick={() => navigate(-1)} className="text-brand-accent/60 text-sm text-left">← Back</button>
      <div>
        <h2 className="text-2xl font-bold text-brand-accent">Redeem RemitVoucher</h2>
        <p className="text-brand-accent/60 text-sm mt-1">Enter your 16-digit voucher code.</p>
      </div>
      <div className="space-y-1">
        <label className="block text-xs text-brand-accent/60 uppercase tracking-wide font-medium">Voucher Code</label>
        <input
          type="text" inputMode="numeric"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChange={e => { setCode(formatVoucher(e.target.value)); setError(''); setState('idle'); }}
          className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-4 text-xl text-center font-mono text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent tracking-widest"
          maxLength={19}
        />
      </div>
      {(state === 'error' || error) && (
        <div className="flex items-center gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-4 py-3 text-brand-danger text-sm">
          <AlertCircle size={16} /> {error || 'Invalid or already redeemed voucher'}
        </div>
      )}
      <button onClick={redeem} disabled={state === 'loading'} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold disabled:opacity-40 active:scale-95">
        {state === 'loading' ? 'Verifying voucher…' : 'Redeem Voucher'}
      </button>
    </div>
  );
}
