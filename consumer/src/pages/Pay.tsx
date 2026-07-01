import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, X, QrCode, Share2 } from 'lucide-react';
import { DoubleChevron } from '@/components/DoubleChevron';
import { QrScanner } from '@/components/QrScanner';
import {
  prepareTransfer, signAndSubmitTransfer, prepareEscrow, signAndSubmitEscrow,
  type TransferResult, type EscrowResult,
} from '@/lib/pay';
import { api } from '@/lib/api';
import { isPasskeySupported } from '@/lib/passkey';
import { getAppName } from '@/lib/brand';

// Minimal send: pick the wallet to send from, an amount, and a destination — a
// payment tag, 0x address, or a phone number. A phone number routes through the
// WhatsApp-escrow flow (held until the recipient onboards + claims).
type Cur = 'ZAR' | 'USDC';
const SYM: Record<Cur, string> = { ZAR: 'R', USDC: '$' };
const WALLET: Record<Cur, string> = { ZAR: 'Rand wallet', USDC: 'USD wallet' };
function money(n: number, cur: Cur) {
  const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return `${SYM[cur]}${num}`;
}

// A destination that is only digits / +()-. (no @, no 0x) with ≥7 digits is a phone.
function looksLikePhone(v: string): boolean {
  const s = v.trim();
  if (!s || s.startsWith('0x') || s.includes('@')) return false;
  return /^\+?[\d\s().-]+$/.test(s) && s.replace(/\D/g, '').length >= 7;
}

interface BalanceSummary { zar: { formatted: string }; usd: { formatted: string } }

export default function Pay() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialFrom = (location.state as { from?: Cur } | null)?.from ?? 'ZAR';

  const [currency, setCurrency] = useState<Cur>(initialFrom);
  const [to, setTo]         = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult]   = useState<TransferResult | null>(null);
  const [escrow, setEscrow]   = useState<EscrowResult | null>(null);
  const [avail, setAvail]     = useState<{ ZAR: number; USDC: number } | null>(null);

  useEffect(() => {
    api.get<{ summary: BalanceSummary }>('/consumer/balance')
      .then(b => setAvail({ ZAR: parseFloat(b.summary?.zar.formatted ?? '0'), USDC: parseFloat(b.summary?.usd.formatted ?? '0') }))
      .catch(() => {});
  }, []);

  function friendly(msg: string): string {
    if (msg.includes('SENDER_UNREGISTERED') || msg.includes('not registered')) return 'Your account isn’t registered yet.';
    if (msg.includes('RECIPIENT_UNVERIFIED') || msg.includes('not registered yet')) return 'That recipient has no account yet — send to their phone number instead so they can claim it.';
    if (msg.includes('INSUFFICIENT_BALANCE') || msg.includes('Insufficient')) return 'You don’t have enough balance for this transfer.';
    if (msg.includes('No account found')) return msg;
    if (msg.includes('cancelled')) return 'Approval was cancelled. Try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  const phone = looksLikePhone(to);

  // A scanned QR is either a POS pay-request ({imali, to, amt, cur}) — prefill the
  // recipient + amount — or a plain tag / address / phone.
  function onScan(text: string) {
    setScanning(false); setError('');
    try {
      const p = JSON.parse(text) as { imali?: unknown; to?: string; amt?: string };
      if (p && p.imali && p.to) { setTo(String(p.to)); if (p.amt) setAmount(String(p.amt)); return; }
    } catch { /* not a structured pay-request */ }
    setTo(text.trim());
  }

  async function send() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0)      { setError('Enter an amount'); return; }
    if (!to.trim())            { setError('Enter a destination'); return; }
    if (!isPasskeySupported()) { setError('Passkeys aren’t supported on this device.'); return; }
    setLoading(true); setError('');
    try {
      if (phone) {
        const prepared = await prepareEscrow({ recipientPhone: to.trim(), amount, currency });
        const r = await signAndSubmitEscrow(prepared);
        setEscrow(r);
        window.open(r.waLink, '_blank'); // open WhatsApp with the prefilled claim link
      } else {
        const prepared = await prepareTransfer({ to: to.trim(), amount, currency });
        setResult(await signAndSubmitTransfer(prepared));
      }
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setLoading(false);
    }
  }

  // ── Escrow success (sent to a phone number) ──────────────────────────────────
  if (escrow) {
    const days = Math.max(1, Math.round((new Date(escrow.expiresAt).getTime() - Date.now()) / 86_400_000));
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
            <CheckCircle2 size={44} className="text-brand-accent" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-brand-accent">Held for {to.trim()}</h2>
            <p className="text-brand-accent/70 text-sm">
              {money(parseFloat(amount), currency)} is held safely. Share the link so they can create their {getAppName() || 'iMali'} account and claim it. Unclaimed after {days} days, it returns to you.
            </p>
          </div>
          <button onClick={() => window.open(escrow.waLink, '_blank')} className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform flex items-center justify-center gap-2">
            <Share2 size={18} /> Share on WhatsApp
          </button>
          <button onClick={() => navigator.clipboard?.writeText(escrow.claimUrl)} className="text-brand-accent/70 text-sm">Copy claim link</button>
          <button onClick={() => navigate('/home')} className="block w-full text-brand-accent/60 text-sm">Back to Home</button>
        </div>
      </div>
    );
  }

  // ── Transfer success (sent to an account) ────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
            <CheckCircle2 size={44} className="text-brand-accent" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-brand-accent">Sent</h2>
            <p className="text-brand-accent/70 text-sm">{money(parseFloat(amount), currency)} sent to {to.startsWith('0x') ? `${to.slice(0, 6)}…${to.slice(-4)}` : to}</p>
            <a href={`https://sepolia.etherscan.io/tx/${result.txHash}`} target="_blank" rel="noreferrer" className="text-brand-accent text-xs font-mono underline break-all">
              {result.txHash.slice(0, 10)}…{result.txHash.slice(-8)}
            </a>
          </div>
          <button onClick={() => navigate('/home')} className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform">Done</button>
        </div>
      </div>
    );
  }

  // ── Send form (overlaid card) ─────────────────────────────────────────────────
  return (
    <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
      {scanning && <QrScanner onResult={onScan} onClose={() => setScanning(false)} />}
      <div className="w-full max-w-sm bg-brand-card rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-accent">Send</h2>
          <button onClick={() => navigate(-1)} aria-label="Close"><X size={20} className="text-brand-accent/60" /></button>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-3 py-2 text-brand-danger text-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {/* 1. From wallet */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-brand-accent">From</label>
          <select
            value={currency}
            onChange={e => { setCurrency(e.target.value as Cur); setError(''); }}
            className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
          >
            {(['ZAR', 'USDC'] as const).map(c => (
              <option key={c} value={c}>{WALLET[c]}{avail ? ` — ${money(avail[c], c)}` : ''}</option>
            ))}
          </select>
        </div>

        {/* 2. Amount */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-brand-accent">Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-accent/50 font-semibold">{SYM[currency]}</span>
            <input
              type="number" inputMode="decimal" value={amount} placeholder="0.00"
              onChange={e => { setAmount(e.target.value); setError(''); }}
              className="w-full bg-white border border-brand-accent/20 rounded-xl pl-7 pr-3 py-3 text-lg font-semibold text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
            />
          </div>
        </div>

        {/* 3. Destination + Scan */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-brand-accent">To</label>
            <button type="button" onClick={() => setScanning(true)} className="flex items-center gap-1 text-xs font-medium text-brand-accent">
              <QrCode size={14} /> Scan
            </button>
          </div>
          <input
            value={to} placeholder="Tag, phone number, or scan a QR code"
            onChange={e => { setTo(e.target.value); setError(''); }}
            className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent placeholder-brand-accent/30"
          />
          {phone && <p className="text-xs text-brand-accent/60 px-1">We’ll hold it and send a WhatsApp claim link to this number.</p>}
        </div>

        <button
          onClick={send}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform disabled:opacity-40"
        >
          {loading ? 'Sending…' : <>Send <DoubleChevron size={18} /></>}
        </button>
      </div>
    </div>
  );
}
