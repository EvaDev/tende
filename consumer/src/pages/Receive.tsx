import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { QrCode, CheckCircle2, X, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import BottomNav from '@/components/BottomNav';
import { QrScanner } from '@/components/QrScanner';
import { api } from '@/lib/api';
import { getAppName } from '@/lib/brand';

type Tab = 'scan' | 'tag';

interface ChangeSummary {
  status: string;
  amount: string;
  currency: string;
  merchantName: string;
  expired: boolean;
}

function money(amount: string, currency: string) {
  const n = parseFloat(amount);
  const sym = currency === 'USDC' || currency === 'USD' ? '$' : 'R';
  return `${sym}${Number.isFinite(n) ? n.toFixed(2) : amount}`;
}

export default function Receive() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>('scan');
  const [tag, setTag] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState<{ secret: string; summary: ChangeSummary } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ amount: string; currency: string } | null>(null);

  useEffect(() => {
    api.get<{ ensSubdomain?: string }>('/consumer/me').then(p => setTag(p.ensSubdomain ?? null)).catch(() => {});
    const c = params.get('c');
    if (c) loadSummary(c);
  }, [params]);

  async function loadSummary(secret: string) {
    setError('');
    try {
      const summary = await api.get<ChangeSummary>(`/change-voucher/${encodeURIComponent(secret)}`);
      setPending({ secret, summary });
      setTab('scan');
    } catch (e) {
      setError((e as Error).message ?? 'Invalid change voucher link');
    }
  }

  function onScan(text: string) {
    setScanning(false);
    setError('');
    try {
      const p = JSON.parse(text) as { imali?: unknown; type?: string; s?: string; amt?: string; n?: string };
      if (p?.imali && p.type === 'change' && p.s) {
        loadSummary(String(p.s));
        return;
      }
    } catch { /* fall through */ }
    setError(`That’s not a ${getAppName()} change voucher QR. Ask the cashier to show the change voucher code.`);
  }

  async function claim() {
    if (!pending) return;
    setLoading(true);
    setError('');
    try {
      const r = await api.post<{ amount: string; currency: string }>(
        `/change-voucher/${encodeURIComponent(pending.secret)}/redeem`,
        {},
      );
      setPending(null);
      setDone({ amount: r.amount, currency: r.currency });
    } catch (e) {
      setError((e as Error).message ?? 'Could not receive voucher');
    } finally {
      setLoading(false);
    }
  }

  const shareLink = pending
    ? `${window.location.origin}${window.location.pathname}#/receive?c=${encodeURIComponent(pending.secret)}`
    : '';

  return (
    <>
      <div className="flex flex-col min-h-dvh pb-24 px-6 pt-12">
        <h2 className="text-2xl font-bold text-white mb-1">Receive</h2>
        <p className="text-sm text-white/80 mb-4">Scan store change voucher or share your payment tag.</p>

        <div className="flex gap-2 mb-4">
          {(['scan', 'tag'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                tab === t ? 'bg-brand-accent text-white' : 'bg-brand-card text-brand-accent border border-brand-accent/20'
              }`}
            >
              {t === 'scan' ? 'Change voucher' : 'My @tag'}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-200 bg-red-900/30 rounded-xl px-4 py-3 mb-3">{error}</p>}

        {done && (
          <div className="bg-brand-card rounded-2xl p-6 text-center space-y-3 mb-4">
            <CheckCircle2 size={40} className="mx-auto text-brand-accent" />
            <p className="font-semibold text-brand-accent">Change received</p>
            <p className="text-2xl font-bold text-brand-accent">{money(done.amount, done.currency)}</p>
            <button onClick={() => navigate('/home')} className="w-full py-3 rounded-xl bg-brand-accent text-white font-semibold">
              Back to home
            </button>
          </div>
        )}

        {tab === 'scan' && !done && (
          <div className="space-y-4">
            {!pending && (
              <>
                <p className="text-sm text-white/80">
                  After paying in store, scan the cashier&apos;s <strong>change voucher</strong> QR to add the balance to your wallet.
                </p>
                <button
                  onClick={() => setScanning(true)}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-brand-accent text-white font-bold active:scale-95"
                >
                  <QrCode size={22} /> Scan change voucher
                </button>
              </>
            )}

            {pending && (
              <div className="bg-brand-card rounded-2xl p-5 space-y-4">
                <div className="text-center">
                  <p className="text-sm text-gray-500">Change from</p>
                  <p className="text-lg font-bold text-brand-accent">{pending.summary.merchantName}</p>
                  <p className="text-3xl font-bold text-brand-accent mt-2">
                    {money(pending.summary.amount, pending.summary.currency)}
                  </p>
                  {pending.summary.expired && (
                    <p className="text-sm text-red-600 mt-2">This voucher has expired.</p>
                  )}
                </div>
                <button
                  onClick={claim}
                  disabled={loading || pending.summary.status !== 'pending' || pending.summary.expired}
                  className="w-full py-3 rounded-xl bg-brand-accent text-white font-semibold disabled:opacity-50"
                >
                  {loading ? 'Receiving…' : 'Receive to wallet'}
                </button>
                {shareLink && (
                  <button
                    type="button"
                    onClick={() => navigator.share?.({ url: shareLink, title: 'Change voucher' })
                      .catch(() => navigator.clipboard?.writeText(shareLink))}
                    className="w-full flex items-center justify-center gap-2 py-2 text-sm text-brand-accent underline"
                  >
                    <Share2 size={16} /> Share link (WhatsApp)
                  </button>
                )}
                <button type="button" onClick={() => setPending(null)} className="w-full text-sm text-gray-500">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'tag' && (
          <div className="bg-brand-card rounded-2xl p-6 text-center space-y-3">
            <p className="text-brand-accent/60 text-sm">Someone paying you can send to</p>
            {tag
              ? <div className="flex justify-center"><QRCodeSVG value={`@${tag}`} size={176} fgColor="#3D1919" bgColor="#FFFFFF" level="M" /></div>
              : <p className="text-brand-accent/50 text-sm">No payment tag yet</p>}
            <p className="text-xl font-bold text-brand-accent">{tag ? `@${tag}` : '—'}</p>
            {tag && (
              <button
                onClick={() => navigator.clipboard?.writeText(`@${tag}`)}
                className="w-full py-3 rounded-xl bg-brand-accent text-brand-text font-medium"
              >
                Copy tag
              </button>
            )}
          </div>
        )}
      </div>

      {scanning && (
        <div className="fixed inset-0 z-[70] bg-black">
          <button onClick={() => setScanning(false)} className="absolute top-4 right-4 z-10 text-white p-2" aria-label="Close">
            <X size={28} />
          </button>
          <QrScanner onResult={onScan} onClose={() => setScanning(false)} />
        </div>
      )}

      <BottomNav />
    </>
  );
}
