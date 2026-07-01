import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

type Step = 'destination' | 'amount' | 'confirm' | 'success';
type PayoutMethod = 'bank' | 'mobile_money' | 'cash';

interface Corridor {
  send_country_code: string; receive_country_code: string; status: string;
  receive_country_name: string;
  send_currency: string;   send_symbol: string;
  receive_currency: string; receive_symbol: string;
}
interface Partner { partner_id: number; method: string; name: string }
interface Currency { code: string; name: string; symbol: string; currency_type: string }
interface FxQuote { from: string; to: string; rate: number | null; source: string }

interface Form {
  country: string; method: PayoutMethod | ''; bankName: string; branchCode: string;
  accountNumber: string; mobileOperator: string; recipientMobile: string;
  recipientName: string; recipientId: string; relationship: string;
  currency: string; amount: string;
}

// Country code → flag emoji via regional indicator symbols
function flagEmoji(code: string): string {
  if (code.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function Select({ label, options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: string[] }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-white uppercase tracking-wide font-medium">{label}</label>
      <select {...props} className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent">
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-white uppercase tracking-wide font-medium">{label}</label>
      <input {...props} className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent placeholder-brand-accent/30" />
    </div>
  );
}

export default function Send() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('destination');
  const [form, setForm] = useState<Form>({
    country: '', method: '', bankName: '', branchCode: '', accountNumber: '',
    mobileOperator: '', recipientMobile: '', recipientName: '', recipientId: '',
    relationship: '', currency: '', amount: '',
  });
  const [error, setError] = useState('');

  // Reference data from the DB
  const [corridors, setCorridors]     = useState<Corridor[]>([]);
  const [partners, setPartners]       = useState<Partner[]>([]);
  const [fiatCurrencies, setFiat]     = useState<Currency[]>([]);
  const [relationships, setRelations] = useState<string[]>([]);
  const [fx, setFx]                   = useState<FxQuote | null>(null);

  const corridor = corridors.find(c => c.receive_country_code === form.country);

  // Load corridors, currencies, relationship options once
  useEffect(() => {
    api.get<Corridor[]>('/corridors').then(rows => {
      setCorridors(rows);
      const firstActive = rows.find(c => c.status === 'active');
      if (firstActive) setForm(f => ({ ...f, country: firstActive.receive_country_code, currency: firstActive.receive_currency }));
    }).catch(() => {});
    api.get<Currency[]>('/currencies').then(rows => setFiat(rows.filter(c => c.currency_type === 'FIAT'))).catch(() => {});
    api.get<{ label: string }[]>('/kyc-options?category=relationship').then(rows => setRelations(rows.map(r => r.label))).catch(() => {});
  }, []);

  // Load payout partners when receive country + method are known
  useEffect(() => {
    if (!form.country || !form.method || form.method === 'cash') { setPartners([]); return; }
    api.get<Partner[]>(`/corridors/${form.country}/partners?method=${form.method}`).then(setPartners).catch(() => setPartners([]));
  }, [form.country, form.method]);

  // Look up FX whenever the send/receive currency pair changes
  useEffect(() => {
    if (!corridor || !form.currency) { setFx(null); return; }
    api.get<FxQuote>(`/fx/rate?from=${corridor.send_currency}&to=${form.currency}`).then(setFx).catch(() => setFx(null));
  }, [corridor?.send_currency, form.currency]);

  function set(k: keyof Form, v: string) { setForm(f => ({ ...f, [k]: v })); setError(''); }

  function submitDestination() {
    if (!form.method) { setError('Select a payout method'); return; }
    if (!form.recipientName) { setError('Enter recipient full name'); return; }
    if (form.method === 'bank' && (!form.bankName || !form.accountNumber)) { setError('Enter bank details'); return; }
    if (form.method === 'mobile_money' && !form.recipientMobile) { setError('Enter recipient mobile number'); return; }
    setStep('amount');
  }

  function submitAmount() {
    if (!form.currency) { setError('Select currency'); return; }
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (fxRate == null) { setError('Exchange rate unavailable for this currency — please try another'); return; }
    setStep('confirm');
  }

  function submitConfirm() { setStep('success'); }

  // Send amount is in the corridor's send currency; rate converts send→receive.
  const sendSymbol = corridor?.send_symbol ?? '';
  const fxRate = fx?.rate ?? null;
  const sendAmount = parseFloat(form.amount || '0');
  const recipientReceives = fxRate != null ? sendAmount * fxRate : 0;

  if (step === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-8 gap-8">
        <div className="w-24 h-24 rounded-full bg-brand-accent/10 flex items-center justify-center">
          <CheckCircle2 size={48} className="text-brand-accent" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-white">Transfer Initiated</h2>
          <p className="text-white">
            {form.method === 'cash'
              ? 'A FlashRemit Voucher will be generated for your recipient.'
              : `Sending ${recipientReceives.toFixed(2)} ${form.currency} to ${form.recipientName}.`}
          </p>
        </div>
        <button onClick={() => navigate('/home')} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">
          Back to Home
        </button>
      </div>
    );
  }

  const progressSteps: Step[] = ['destination', 'amount', 'confirm'];
  const progressIdx = progressSteps.indexOf(step);

  return (
    <div className="flex flex-col min-h-dvh">
      <div className="px-6 pt-10 pb-4 space-y-4">
        <div className="flex items-center gap-4">
          <button onClick={() => step === 'destination' ? navigate(-1) : setStep(step === 'amount' ? 'destination' : 'amount')} className="text-white">←</button>
          <h2 className="text-xl font-bold text-white">
            {step === 'destination' ? 'Send Money' : step === 'amount' ? 'Amount' : 'Confirm Transfer'}
          </h2>
        </div>
        <div className="flex gap-1">
          {progressSteps.map((_, i) => (
            <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${i <= progressIdx ? 'bg-brand-accent' : 'bg-brand-accent/20'}`} />
          ))}
        </div>
      </div>

      <div className="flex-1 px-6 pb-8 overflow-y-auto space-y-4">
        {error && (
          <div className="flex items-center gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-4 py-3 text-brand-danger text-sm">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {step === 'destination' && (
          <>
            <div className="space-y-1">
              <label className="block text-xs text-white uppercase tracking-wide font-medium">Destination Country</label>
              <div className="flex flex-wrap gap-2">
                {corridors.filter(c => c.status !== 'coming_soon').map(c => {
                  const active = c.status === 'active';
                  const selected = form.country === c.receive_country_code;
                  return (
                    <button
                      key={c.receive_country_code}
                      disabled={!active}
                      onClick={() => active && setForm(f => ({ ...f, country: c.receive_country_code, currency: c.receive_currency }))}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium border-2 transition-colors ${
                        selected ? 'bg-brand-accent/10 border-brand-accent text-brand-accent'
                        : active ? 'bg-brand-card border-brand-accent/20 text-brand-accent/60'
                        : 'bg-brand-accent/5 border-brand-accent/20 text-brand-accent/30 opacity-50 cursor-not-allowed'}`}
                    >
                      {flagEmoji(c.receive_country_code)} {c.receive_country_name}
                    </button>
                  );
                })}
              </div>
              {corridors.some(c => c.status === 'coming_soon') && (
                <p className="text-white text-xs px-1">
                  {corridors.filter(c => c.status === 'coming_soon').map(c => c.receive_country_name).join(', ')} — Coming Soon
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-xs text-white uppercase tracking-wide font-medium">Recipient Receives Via</label>
              <div className="grid grid-cols-3 gap-2">
                {(['bank','mobile_money','cash'] as PayoutMethod[]).map(m => (
                  <button
                    key={m}
                    onClick={() => set('method', m)}
                    className={`py-3 rounded-xl text-xs font-medium border-2 transition-colors ${form.method === m ? 'border-brand-accent bg-brand-accent/10 text-brand-accent' : 'border-brand-accent/20 bg-brand-card text-brand-accent/50'}`}
                  >
                    {m === 'bank' ? '🏦 Bank' : m === 'mobile_money' ? '📱 Mobile Money' : '💵 Cash'}
                  </button>
                ))}
              </div>
            </div>

            {form.method === 'bank' && (
              <>
                <Select label="Bank Name" options={partners.map(p => p.name)} value={form.bankName} onChange={e => set('bankName', e.target.value)} />
                <Field label="Branch / Sort Code" value={form.branchCode} onChange={e => set('branchCode', e.target.value)} />
                <Field label="Account Number" value={form.accountNumber} onChange={e => set('accountNumber', e.target.value)} inputMode="numeric" />
              </>
            )}
            {form.method === 'mobile_money' && (
              <>
                <Select label="Operator" options={partners.map(p => p.name)} value={form.mobileOperator} onChange={e => set('mobileOperator', e.target.value)} />
                <Field label="Recipient Mobile Number" value={form.recipientMobile} onChange={e => set('recipientMobile', e.target.value)} type="tel" />
              </>
            )}
            {form.method === 'cash' && (
              <div className="bg-brand-accent/5 border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent/70">
                A FlashRemit Voucher will be generated for your recipient to collect cash.
              </div>
            )}

            {form.method && (
              <>
                <Field label="Recipient Full Name" value={form.recipientName} onChange={e => set('recipientName', e.target.value)} placeholder="As on ID document" />
                <Field label="Recipient ID / Passport Number" value={form.recipientId} onChange={e => set('recipientId', e.target.value)} />
                <Select label="Relationship to Recipient" options={relationships} value={form.relationship} onChange={e => set('relationship', e.target.value)} />
              </>
            )}

            <button onClick={submitDestination} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">
              Continue <ChevronRight size={16} className="inline" />
            </button>
          </>
        )}

        {step === 'amount' && (
          <>
            <div className="space-y-1">
              <label className="block text-xs text-white uppercase tracking-wide font-medium">Currency Recipient Receives</label>
              <select
                value={form.currency}
                onChange={e => set('currency', e.target.value)}
                className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
              >
                <option value="">Select…</option>
                {fiatCurrencies.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-white uppercase tracking-wide font-medium">
                Amount to Send{corridor ? ` (${corridor.send_currency})` : ''}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-accent/50 font-semibold">{sendSymbol}</span>
                <input
                  type="number" inputMode="decimal" value={form.amount}
                  onChange={e => set('amount', e.target.value)}
                  className="w-full bg-brand-card border border-brand-accent/20 rounded-xl pl-8 pr-4 py-4 text-xl font-semibold text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
                  placeholder="0.00"
                />
              </div>
            </div>
            {parseFloat(form.amount) > 0 && (
              <div className="bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm space-y-1">
                {fxRate != null ? (
                  <>
                    <div className="flex justify-between text-brand-accent/60">
                      <span>Indicative FX rate</span>
                      <span>1 {corridor?.send_currency} = {fxRate.toFixed(4)} {form.currency}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span className="text-brand-accent">Recipient receives</span>
                      <span className="text-brand-accent">{recipientReceives.toFixed(2)} {form.currency}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-brand-danger">Exchange rate unavailable for {corridor?.send_currency} → {form.currency}.</div>
                )}
              </div>
            )}
            <button onClick={submitAmount} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">
              Get Quotes <ChevronRight size={16} className="inline" />
            </button>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="bg-brand-card border border-brand-accent/20 rounded-2xl divide-y divide-brand-accent/10">
              {[
                ['Recipient', form.recipientName],
                ['Payout Method', form.method.replace('_', ' ')],
                ...(form.method === 'bank' ? [['Bank', form.bankName], ['Account', form.accountNumber]] : []),
                ...(form.method === 'mobile_money' ? [['Operator', form.mobileOperator], ['Mobile', form.recipientMobile]] : []),
                ['You Send', `${sendSymbol}${parseFloat(form.amount).toFixed(2)}`],
                ['They Receive', `${recipientReceives.toFixed(2)} ${form.currency}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-brand-accent/60">{label}</span>
                  <span className="font-medium text-brand-accent capitalize">{value}</span>
                </div>
              ))}
            </div>
            <button onClick={submitConfirm} className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold active:scale-95">
              Confirm & Send
            </button>
          </>
        )}
      </div>
    </div>
  );
}
