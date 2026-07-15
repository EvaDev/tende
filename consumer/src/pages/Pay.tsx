import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, X, QrCode, Share2 } from 'lucide-react';
import { DoubleChevron } from '@/components/DoubleChevron';
import { QrScanner } from '@/components/QrScanner';
import {
  executeTransfer, prepareEscrow, signAndSubmitEscrow, executeWithdraw,
  type TransferResult, type EscrowResult, type TransferStep, type WithdrawResult,
} from '@/lib/pay';
import { api } from '@/lib/api';
import { isPasskeySupported } from '@/lib/passkey';
import { getAppName } from '@/lib/brand';
import PaymentProgress, { PAYMENT_STEPS } from '@/components/PaymentProgress';

function looksLikePhone(v: string): boolean {
  const s = v.trim();
  if (!s || s.startsWith('0x') || s.includes('@')) return false;
  return /^\+?[\d\s().-]+$/.test(s) && s.replace(/\D/g, '').length >= 7;
}

function looksLikeOx(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

type Leg = 'SPEND' | 'ZAR' | 'USDC';
const SYM: Record<string, string> = { ZAR: 'R', MWK: 'MK', USD: '$', USDC: '$' };
function money(n: number, cur: string, symOverride?: string) {
  const num = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const sym = symOverride ?? SYM[cur.toUpperCase()] ?? cur;
  return `${sym}${num}`;
}

interface BalanceSummary {
  localCurrency: string;
  localSymbol: string;
  hasSeparateZar?: boolean;
  spend: { currency: string; formatted: string };
  zar: { currency: string; formatted: string };
  usd: { formatted: string };
}

export default function Pay() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { from?: Leg; spendCurrency?: string } | null;

  const [spendCode, setSpendCode] = useState('ZAR');
  const [spendSym, setSpendSym]   = useState('R');
  const [hasSeparateZar, setHasSeparateZar] = useState(false);
  const [currency, setCurrency]   = useState('ZAR');
  const [to, setTo]         = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [payStep, setPayStep] = useState<TransferStep | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult]   = useState<TransferResult | null>(null);
  const [withdraw, setWithdraw] = useState<WithdrawResult | null>(null);
  const [escrow, setEscrow]   = useState<EscrowResult | null>(null);
  const [avail, setAvail]     = useState<Record<string, number>>({});
  const [recipName, setRecipName] = useState('');
  const [recipId, setRecipId] = useState('');
  const [recipPhone, setRecipPhone] = useState('');
  const [recipCountry, setRecipCountry] = useState('');
  const [recipRel, setRecipRel] = useState('');

  useEffect(() => {
    api.get<{ summary: BalanceSummary }>('/consumer/balance')
      .then(b => {
        const s = b.summary;
        const code = s?.spend?.currency ?? s?.localCurrency ?? 'ZAR';
        const sym  = s?.localSymbol ?? SYM[code] ?? code;
        const separateZar = s?.hasSeparateZar ?? code !== 'ZAR';
        setSpendCode(code);
        setSpendSym(sym);
        setHasSeparateZar(separateZar);
        const spendBal = parseFloat(s?.spend?.formatted ?? '0');
        const zarBal   = parseFloat(s?.zar?.formatted ?? '0');
        const usdBal   = parseFloat(s?.usd?.formatted ?? '0');
        setAvail({
          ...(separateZar ? { [code]: spendBal } : {}),
          ZAR: zarBal,
          USDC: usdBal,
        });
        const from = navState?.from;
        setCurrency(from === 'USDC' ? 'USDC' : from === 'ZAR' ? 'ZAR' : code);
      })
      .catch(() => {});
  }, [navState?.from]);

  function friendly(msg: string): string {
    if (msg.includes('SENDER_UNREGISTERED') || msg.includes('not registered')) return 'Your account isn’t registered yet.';
    if (msg.includes('EXTERNAL_WALLET') || msg.includes('withdraw USDC')) {
      return 'That address isn’t an iMali wallet. Convert to USD first, then send USDC to the external address.';
    }
    if (msg.includes('RECIPIENT_UNVERIFIED') || msg.includes('not registered yet')) return 'That recipient has no account yet — send to their phone number instead so they can claim it.';
    if (msg.includes('INSUFFICIENT_BALANCE') || msg.includes('Insufficient')) return 'You don’t have enough balance for this transfer.';
    if (msg.includes('INSUFFICIENT_RESERVES')) return 'Withdrawals are temporarily unavailable — please try again later.';
    if (msg.includes('KYC_SINGLE') || msg.includes('single-transaction')) return msg;
    if (msg.includes('KYC_DAILY') || msg.includes('daily send')) return msg;
    if (msg.includes('KYC_MONTHLY') || msg.includes('monthly spend')) return msg;
    if (msg.includes('USE_INTERNAL_TRANSFER')) return 'That address is already on iMali — send as a normal transfer.';
    if (msg.includes('TRAVEL_RULE') || msg.includes('Recipient full name')) return 'Enter the recipient’s full name for compliance.';
    if (msg.includes('irreversible') || msg.includes('Double-check')) return msg;
    if (msg.includes('No account found')) return msg;
    if (msg.includes('cancelled')) return 'Approval was cancelled. Try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  const amountSym = currency === 'USDC' ? '$' : (currency === spendCode ? spendSym : SYM[currency] ?? currency);
  const phone = looksLikePhone(to);
  const externalOx = looksLikeOx(to);

  function onScan(text: string) {
    setScanning(false); setError('');
    try {
      const p = JSON.parse(text) as { imali?: unknown; to?: string; amt?: string; cur?: string };
      if (p && p.imali && p.to) {
        setTo(String(p.to));
        if (p.amt) setAmount(String(p.amt));
        if (p.cur) {
          const c = p.cur.toUpperCase();
          setCurrency(c === 'USDC' || c === 'USD' ? 'USDC' : c === 'ZAR' ? 'ZAR' : (c || spendCode));
        }
        return;
      }
    } catch { /* not a structured pay-request */ }
    setTo(text.trim());
  }

  async function send() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0)      { setError('Enter an amount'); return; }
    if (!to.trim())            { setError('Enter a destination'); return; }
    if (!isPasskeySupported()) { setError('Passkeys aren’t supported on this device.'); return; }
    setLoading(true); setError(''); setPayStep('prepare');
    try {
      if (phone) {
        const prepared = await prepareEscrow({ recipientPhone: to.trim(), amount, currency });
        const r = await signAndSubmitEscrow(prepared, setPayStep);
        setEscrow(r);
        window.open(r.waLink, '_blank');
      } else if (externalOx && currency === 'USDC') {
        if (!recipName.trim() || recipName.trim().length < 2) {
          setError('Enter the recipient’s full name (required for external wallets).');
          setLoading(false); setPayStep(null); return;
        }
        // Unknown 0x + USDC → external withdraw. If the address is actually an
        // iMali wallet, prepareWithdraw returns USE_INTERNAL_TRANSFER → fall back.
        try {
          setWithdraw(await executeWithdraw({
            to: to.trim(),
            amount,
            beneficiary: {
              fullName: recipName.trim(),
              idNumber: recipId.trim() || undefined,
              phone: recipPhone.trim() || undefined,
              country: recipCountry.trim() || undefined,
              relationship: recipRel || undefined,
            },
          }, setPayStep));
        } catch (e) {
          const msg = (e as Error).message || '';
          if (msg.includes('PLATFORM_ADDRESS') || msg.includes('platform address')) {
            throw new Error(
              'That address is the platform escrow/treasury — funds would stay inside iMali. Paste an external wallet (e.g. MetaMask) to withdraw USDC on-chain.',
            );
          }
          if (msg.includes('USE_INTERNAL_TRANSFER') || msg.includes('iMali wallet')) {
            setResult(await executeTransfer({ to: to.trim(), amount, currency }, setPayStep));
          } else {
            throw e;
          }
        }
      } else if (externalOx && currency !== 'USDC') {
        try {
          setResult(await executeTransfer({ to: to.trim(), amount, currency }, setPayStep));
        } catch (e) {
          const msg = (e as Error).message || '';
          if (msg.includes('EXTERNAL_WALLET') || msg.includes('withdraw USDC') || msg.includes('not registered')) {
            throw new Error('EXTERNAL_WALLET');
          }
          throw e;
        }
      } else {
        setResult(await executeTransfer({ to: to.trim(), amount, currency }, setPayStep));
      }
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setLoading(false);
      setPayStep(null);
    }
  }

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
              {money(parseFloat(amount), currency)} is held safely. Share the link so they can create their {getAppName()} account and claim it. Unclaimed after {days} days, it returns to you.
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

  if (withdraw) {
    const short = `${withdraw.to.slice(0, 6)}…${withdraw.to.slice(-4)}`;
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-6 shadow-xl text-center space-y-4">
          <div className="w-20 h-20 mx-auto rounded-full bg-brand-accent/10 flex items-center justify-center">
            <CheckCircle2 size={44} className="text-brand-accent" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-brand-accent">Withdrawn</h2>
            <p className="text-brand-accent/70 text-sm">
              {money(parseFloat(withdraw.net), 'USDC')} USDC sent to {short}
              {parseFloat(withdraw.fee) > 0 ? ` (fee ${money(parseFloat(withdraw.fee), 'USDC')})` : ''}
            </p>
            <a href={`https://sepolia.etherscan.io/tx/${withdraw.txHash}`} target="_blank" rel="noreferrer" className="text-brand-accent text-xs font-mono underline break-all">
              {withdraw.txHash.slice(0, 10)}…{withdraw.txHash.slice(-8)}
            </a>
          </div>
          <button onClick={() => navigate('/home')} className="w-full py-3.5 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95 transition-transform">Done</button>
        </div>
      </div>
    );
  }

  if (loading && payStep) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6 bg-brand-bg">
        <div className="w-full max-w-sm bg-brand-card rounded-2xl p-5 shadow-xl">
          <PaymentProgress steps={PAYMENT_STEPS} currentId={payStep} />
        </div>
      </div>
    );
  }

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

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-brand-accent">From</label>
          <select
            value={currency}
            onChange={e => { setCurrency(e.target.value); setError(''); }}
            className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
          >
            {hasSeparateZar && (
              <option value={spendCode}>
                {spendCode} wallet{avail[spendCode] != null ? ` — ${money(avail[spendCode], spendCode, spendSym)}` : ''}
              </option>
            )}
            <option value="ZAR">
              Rand wallet{avail.ZAR != null ? ` — ${money(avail.ZAR, 'ZAR')}` : ''}
            </option>
            <option value="USDC">
              USD wallet{avail.USDC != null ? ` — ${money(avail.USDC, 'USDC')}` : ''}
            </option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-brand-accent">Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-accent/50 font-semibold">{amountSym}</span>
            <input
              type="number" inputMode="decimal" value={amount} placeholder="0.00"
              onChange={e => { setAmount(e.target.value); setError(''); }}
              className="w-full bg-white border border-brand-accent/20 rounded-xl pl-7 pr-3 py-3 text-lg font-semibold text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-brand-accent">To</label>
            <button type="button" onClick={() => setScanning(true)} className="flex items-center gap-1 text-xs font-medium text-brand-accent">
              <QrCode size={14} /> Scan
            </button>
          </div>
          <input
            value={to} placeholder="@tag, account number, phone, 0x address, or scan QR"
            onChange={e => { setTo(e.target.value); setError(''); }}
            className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent placeholder-brand-accent/30"
          />
          {phone && <p className="text-xs text-brand-accent/60 px-1">We’ll hold it and send a WhatsApp claim link to this number.</p>}
          {externalOx && currency === 'USDC' && (
            <p className="text-xs text-brand-accent/60 px-1">
              External wallet — USDC will be sent on-chain (irreversible). A small platform fee may apply.
            </p>
          )}
          {externalOx && currency !== 'USDC' && (
            <p className="text-xs text-brand-accent/60 px-1">
              External wallets only accept USDC. Switch to USD wallet or convert first.
            </p>
          )}
          {!phone && !externalOx && /^\d{4,}$/.test(to.trim()) && (
            <p className="text-xs text-brand-accent/60 px-1">Sending to account number {to.trim()}.</p>
          )}
        </div>

        {externalOx && currency === 'USDC' && (
          <div className="space-y-3 rounded-xl border border-brand-accent/15 bg-brand-accent/[0.03] p-3">
            <p className="text-xs font-semibold text-brand-accent">Recipient details (Travel Rule)</p>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-brand-accent/80">Full name *</label>
              <input
                value={recipName}
                onChange={e => { setRecipName(e.target.value); setError(''); }}
                placeholder="Legal name of the person receiving"
                className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-2.5 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-brand-accent/80">ID / passport number</label>
              <input
                value={recipId}
                onChange={e => setRecipId(e.target.value)}
                placeholder="Optional"
                className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-2.5 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-brand-accent/80">Phone</label>
                <input
                  value={recipPhone}
                  onChange={e => setRecipPhone(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-2.5 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-brand-accent/80">Country</label>
                <input
                  value={recipCountry}
                  onChange={e => setRecipCountry(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="ZA"
                  maxLength={2}
                  className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-2.5 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent uppercase"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-brand-accent/80">Relationship</label>
              <select
                value={recipRel}
                onChange={e => setRecipRel(e.target.value)}
                className="w-full bg-white border border-brand-accent/20 rounded-xl px-3 py-2.5 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
              >
                <option value="">Optional</option>
                <option value="immediate_family">Immediate family</option>
                <option value="extended_family">Extended family</option>
                <option value="friend">Friend</option>
                <option value="employee">Employee</option>
                <option value="employer">Employer</option>
                <option value="business_partner">Business partner</option>
                <option value="self">Self (own wallet)</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        )}

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
