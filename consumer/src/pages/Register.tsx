import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, AlertCircle, CheckCircle2, Fingerprint, AtSign } from 'lucide-react';
import { api, setToken } from '@/lib/api';
import { createPasskey, isPasskeySupported } from '@/lib/passkey';
import { getEnsParentDomain, getAppName } from '@/lib/brand';

interface RegField {
  field_key: string; label: string;
  included: boolean; required: boolean;
  verification_method: string;
}

type Step = 'mobile' | 'details' | 'financial' | 'tag' | 'wallet' | 'success';
const ALL_STEPS: Step[] = ['mobile', 'details', 'financial', 'tag', 'wallet'];

const STEP_FIELDS: Record<Step, string[]> = {
  mobile:    ['mobile'],
  details:   ['full_name', 'dob', 'address', 'email'],
  financial: ['occupation', 'income_source'],
  tag:       ['account_tag'],
  wallet:    [],
  success:   [],
};

interface Form {
  mobile: string; fullName: string; dob: string;
  address1: string; address2: string; city: string; province: string;
  postalCode: string; email: string; occupation: string; incomeSource: string;
  accountTag: string; walletAddress: string; ownershipSignature: string;
}

function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      className="w-full py-4 rounded-2xl bg-brand-accent text-brand-text font-semibold text-base active:scale-95 transition-all disabled:opacity-40 shadow-sm"
      onClick={onClick} disabled={disabled}
    >{children}</button>
  );
}

function Field({ label, required: req, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-brand-accent/60 uppercase tracking-wide font-medium">{label}{req && ' *'}</label>
      <input {...props} className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent placeholder-brand-accent/30" />
    </div>
  );
}

function Select({ label, options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: string[] }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-brand-accent/60 uppercase tracking-wide font-medium">{label}</label>
      <select {...props} className="w-full bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent">
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

const STEP_LABELS: Record<Step, string> = {
  mobile: 'Mobile Number', details: 'Personal Details', financial: 'Financial Profile',
  tag: 'Account Tag', wallet: 'Secure Account', success: '',
};

export default function Register() {
  const navigate = useNavigate();
  const [fields, setFields]         = useState<RegField[]>([]);
  const [activeSteps, setActiveSteps] = useState<Step[]>(ALL_STEPS);
  const [step, setStep]             = useState<Step | null>(null); // null until config loads
  const [form, setForm]             = useState<Form>({
    mobile: '', fullName: '', dob: '', address1: '', address2: '',
    city: '', province: '', postalCode: '', email: '',
    occupation: '', incomeSource: '', accountTag: '', walletAddress: '', ownershipSignature: '',
  });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [tagAvailable, setTagAvailable] = useState<boolean | null>(null);
  const [occupations, setOccupations]     = useState<string[]>([]);
  const [incomeSources, setIncomeSources] = useState<string[]>([]);
  // Country auto-detected from the browser locale, validated against supported countries.
  const [country, setCountry] = useState<{ code: string; dial_code: string } | null>(null);

  // Timezone reflects physical location better than UI language. Covers supported countries.
  const TZ_COUNTRY: Record<string, string> = {
    'Africa/Johannesburg': 'ZA', 'Africa/Harare': 'ZW', 'Africa/Gaborone': 'BW',
    'Africa/Nairobi': 'KE', 'Africa/Blantyre': 'MW', 'Africa/Maputo': 'MZ',
    'Africa/Windhoek': 'NA', 'Africa/Lagos': 'NG',
  };
  function detectByTimezone(): string | null {
    try { return TZ_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? null; }
    catch { return null; }
  }
  // Ordered candidate region codes from the browser locale(s) — fallback.
  function candidateRegions(): string[] {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    return langs
      .map(l => l?.split('-')[1]?.toUpperCase())
      .filter((r): r is string => !!r && /^[A-Z]{2}$/.test(r));
  }

  useEffect(() => {
    api.get<{ label: string }[]>('/kyc-options?category=occupation').then(rows => setOccupations(rows.map(r => r.label))).catch(() => {});
    api.get<{ label: string }[]>('/kyc-options?category=income_source').then(rows => setIncomeSources(rows.map(r => r.label))).catch(() => {});
    api.get<{ code: string; dial_code: string }[]>('/countries').then(rows => {
      // Timezone wins (physical location); then browser-locale region; then first active.
      const tzCode  = detectByTimezone();
      const tzMatch = tzCode ? rows.find(c => c.code === tzCode) : undefined;
      const regions = candidateRegions();
      const localeMatch = regions.map(r => rows.find(c => c.code === r)).find(Boolean);
      setCountry(tzMatch ?? localeMatch ?? rows[0] ?? null);
    }).catch(() => {});
    api.get<RegField[]>('/config/registration-fields').then(rows => {
      setFields(rows);
      const enabled = ALL_STEPS.filter(s => {
        const keys = STEP_FIELDS[s];
        if (keys.length === 0) return true;
        return keys.some(k => {
          const f = rows.find(r => r.field_key === k);
          return f ? f.included : false;
        });
      });
      setActiveSteps(enabled);
      setStep(enabled[0] ?? 'wallet');
    }).catch(() => {
      setActiveSteps(ALL_STEPS);
      setStep('mobile');
    });
  }, []);

  function isIncluded(key: string) {
    const f = fields.find(r => r.field_key === key);
    return f ? f.included : true;
  }
  function isRequired(key: string) {
    const f = fields.find(r => r.field_key === key);
    return f ? f.required : false;
  }

  function set(k: keyof Form, v: string) { setForm(f => ({ ...f, [k]: v })); setError(''); }

  function nextStep() {
    const idx = activeSteps.indexOf(step as Step);
    const next = activeSteps[idx + 1];
    if (next) setStep(next); else setStep('success');
    setError('');
  }
  function prevStep() {
    const idx = activeSteps.indexOf(step as Step);
    if (idx > 0) setStep(activeSteps[idx - 1]);
    else navigate('/');
    setError('');
  }

  async function checkTag(tag: string) {
    if (!/^[a-z0-9-]{3,32}$/.test(tag)) { setTagAvailable(null); return; }
    try {
      const res = await api.post<{ available: boolean }>('/register/check-ens', { subdomain: tag });
      setTagAvailable(res.available);
    } catch { setTagAvailable(null); }
  }

  // Create the device passkey (Face ID / Touch ID / Windows Hello), which becomes
  // the signer for the user's Safe wallet, then register. No MetaMask, no gas.
  async function createWalletWithPasskey() {
    if (!isPasskeySupported()) { setError('Passkeys are not supported on this device or browser.'); return; }
    setLoading(true); setError('');
    try {
      const opts     = await api.get<{ challenge: string; rp: { id: string; name: string }; userId: string }>('/auth/passkey/register-options');
      const passkey  = await createPasskey({
        challenge: opts.challenge,
        rpId:      opts.rp.id,
        rpName:    opts.rp.name,
        userId:    opts.userId,
        userName:  form.accountTag || form.fullName || 'iMali user',
      });

      const result = await api.post<{ token?: string; walletAddress?: string }>('/register', {
        credentialId:   passkey.credentialId,
        publicKeyDer:   passkey.publicKeyDer,
        clientDataJSON: passkey.clientDataJSON,
        displayName:    form.fullName || 'Unknown',
        mobileNumber:   form.mobile ? `${country?.dial_code ?? ''}${form.mobile.replace(/\s/g, '')}` : `${country?.dial_code ?? ''}0000000000`,
        countryCode:    country?.code ?? 'ZA',
        ensSubdomain:   form.accountTag,
      });
      if (result.token) setToken(result.token);
      if (result.walletAddress) set('walletAddress', result.walletAddress);
      setStep('success');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('ENS_TAKEN')) { setError('That account tag is taken — go back and choose another.'); setStep('tag'); return; }
      if (msg.includes('PILOT_CAP')) { setError('The pilot is at capacity.'); return; }
      setError(msg || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Loading state while fetching config
  if (step === null) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <div className="w-8 h-8 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-8 gap-8">
        <div className="w-24 h-24 rounded-full bg-brand-accent/10 flex items-center justify-center">
          <CheckCircle2 size={48} className="text-brand-accent" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-brand-accent">Account Created!</h2>
          <p className="text-brand-accent/60">Your {getAppName()} wallet is ready.</p>
          {form.accountTag && <>
            <p className="text-xl font-bold text-brand-accent mt-2">@{form.accountTag}</p>
            <p className="text-xs text-brand-accent/50 font-mono">{form.accountTag}.{getEnsParentDomain()}</p>
          </>}
          <p className="text-3xl font-bold text-brand-accent mt-4">R0.00</p>
          <p className="text-brand-accent/60 text-sm">Available Balance</p>
        </div>
        <Btn onClick={() => navigate('/home')}>Go to Home</Btn>
      </div>
    );
  }

  const progressIdx = activeSteps.indexOf(step);

  return (
    <div className="flex flex-col min-h-dvh">
      <div className="px-6 pt-10 pb-4 space-y-4">
        <div className="flex items-center gap-4">
          <button onClick={prevStep} className="text-brand-accent/60 text-lg">←</button>
          <div className="flex-1">
            <p className="text-xs text-brand-accent/50 uppercase tracking-wide font-medium">
              Step {progressIdx + 1} of {activeSteps.length}
            </p>
            <h2 className="text-xl font-bold text-brand-accent">{STEP_LABELS[step]}</h2>
          </div>
        </div>
        <div className="flex gap-1">
          {activeSteps.map((_, i) => (
            <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${i <= progressIdx ? 'bg-brand-accent' : 'bg-brand-accent/20'}`} />
          ))}
        </div>
      </div>

      <div className="flex-1 px-6 pb-8 overflow-y-auto space-y-5">
        {error && (
          <div className="flex items-start gap-2 bg-brand-danger/10 border border-brand-danger/30 rounded-xl px-4 py-3 text-brand-danger text-sm">
            <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {step === 'mobile' && (
          <>
            <p className="text-brand-accent/60 text-sm">
              {isRequired('mobile') ? 'Enter your mobile number.' : 'Optionally add a mobile number (can be added later).'}
            </p>
            <div className="space-y-1">
              <label className="block text-xs text-brand-accent/60 uppercase tracking-wide font-medium">
                Mobile Number{isRequired('mobile') && ' *'}
              </label>
              <div className="flex gap-2">
                <div className="bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent/60 font-medium">{country?.dial_code ?? '+…'}</div>
                <input type="tel" placeholder="71 234 5678" value={form.mobile}
                  onChange={e => set('mobile', e.target.value)}
                  className="flex-1 bg-brand-card border border-brand-accent/20 rounded-xl px-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent" />
              </div>
            </div>
            <Btn onClick={nextStep}>Continue <ChevronRight size={16} className="inline" /></Btn>
            {!isRequired('mobile') && (
              <button onClick={nextStep} className="w-full text-sm text-brand-accent/50 text-center py-2">Skip for now</button>
            )}
          </>
        )}

        {step === 'details' && (
          <>
            {isIncluded('full_name') && (
              <Field label="Full Name" required={isRequired('full_name')}
                value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="As on your ID" />
            )}
            {isIncluded('dob') && (
              <Field label="Date of Birth" required={isRequired('dob')}
                type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
            )}
            {isIncluded('address') && (<>
              <Field label="Address Line 1" required={isRequired('address')}
                value={form.address1} onChange={e => set('address1', e.target.value)} placeholder="Street address" />
              <Field label="Address Line 2"
                value={form.address2} onChange={e => set('address2', e.target.value)} placeholder="Apt, unit, etc." />
              <Field label="City" value={form.city} onChange={e => set('city', e.target.value)} />
              <Field label="Province" value={form.province} onChange={e => set('province', e.target.value)} />
              <Field label="Postal Code" value={form.postalCode} onChange={e => set('postalCode', e.target.value)} inputMode="numeric" />
            </>)}
            {isIncluded('email') && (
              <Field label="Email Address" required={isRequired('email')}
                type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@example.com" />
            )}
            <Btn onClick={() => {
              if (isRequired('full_name') && !form.fullName) { setError('Full name is required'); return; }
              nextStep();
            }}>Continue <ChevronRight size={16} className="inline" /></Btn>
          </>
        )}

        {step === 'financial' && (
          <>
            <p className="text-brand-accent/60 text-sm">Required for regulatory compliance.</p>
            {isIncluded('occupation') && (
              <Select label="Occupation" options={occupations}
                value={form.occupation} onChange={e => set('occupation', e.target.value)} />
            )}
            {isIncluded('income_source') && (
              <Select label="Source of Income" options={incomeSources}
                value={form.incomeSource} onChange={e => set('incomeSource', e.target.value)} />
            )}
            <Btn onClick={nextStep}>Continue <ChevronRight size={16} className="inline" /></Btn>
          </>
        )}

        {step === 'tag' && (
          <>
            <div className="bg-brand-card border border-brand-accent/20 rounded-2xl p-4 space-y-1 shadow-sm">
              <div className="flex items-center gap-2 text-brand-accent">
                <AtSign size={18} />
                <span className="font-semibold text-sm">Choose your {getAppName()} tag</span>
              </div>
              <p className="text-brand-accent/60 text-xs">Your permanent payment address — like a username for money.</p>
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-brand-accent/60 uppercase tracking-wide font-medium">Account Tag *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-accent/50 font-medium text-sm">@</span>
                <input
                  type="text" placeholder="e.g. thabo" value={form.accountTag} maxLength={32}
                  onChange={e => {
                    const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                    set('accountTag', v); setTagAvailable(null);
                    if (v.length >= 3) checkTag(v);
                  }}
                  className="w-full bg-brand-card border border-brand-accent/20 rounded-xl pl-8 pr-4 py-3 text-sm text-brand-accent outline-none focus:ring-2 focus:ring-brand-accent"
                />
              </div>
              {form.accountTag.length >= 3 && (
                <p className={`text-xs px-1 font-medium ${tagAvailable === true ? 'text-green-600' : tagAvailable === false ? 'text-brand-danger' : 'text-brand-accent/50'}`}>
                  {tagAvailable === true ? `✓ ${form.accountTag}.${getEnsParentDomain()} is available`
                   : tagAvailable === false ? `✗ ${form.accountTag} is already taken`
                   : `Checking ${form.accountTag}.${getEnsParentDomain()}…`}
                </p>
              )}
            </div>
            <p className="text-xs text-brand-accent/50 px-1">3–32 chars. Lowercase letters, numbers, hyphens only. Cannot be changed later.</p>
            <Btn onClick={() => {
              if (!form.accountTag || !/^[a-z0-9-]{3,32}$/.test(form.accountTag)) { setError('Tag must be 3–32 lowercase letters, numbers or hyphens'); return; }
              if (tagAvailable === false) { setError('That tag is already taken'); return; }
              nextStep();
            }} disabled={tagAvailable === false}>Continue <ChevronRight size={16} className="inline" /></Btn>
          </>
        )}

        {step === 'wallet' && (
          <>
            <div className="bg-brand-card border border-brand-accent/20 rounded-2xl p-5 space-y-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-brand-accent/10 flex items-center justify-center">
                  <Fingerprint size={22} className="text-brand-accent" />
                </div>
                <div>
                  <p className="font-semibold text-brand-accent">Secure with your biometrics</p>
                  <p className="text-xs text-brand-accent/60">Face ID, Touch ID or Windows Hello</p>
                </div>
              </div>
              <div className="text-xs text-brand-accent/60 space-y-1 border-t border-brand-accent/10 pt-3">
                <p>✓ Your wallet is created automatically — no seed phrase</p>
                <p>✓ Your identity credential is issued via idOS</p>
                <p>✓ No gas fees, ever — they're sponsored for you</p>
              </div>
            </div>
            {form.accountTag && (
              <div className="bg-brand-accent/5 border border-brand-accent/20 rounded-xl px-4 py-3">
                <p className="text-xs text-brand-accent/50">Your account tag</p>
                <p className="font-bold text-brand-accent">@{form.accountTag} · {form.accountTag}.{getEnsParentDomain()}</p>
              </div>
            )}
            <Btn onClick={createWalletWithPasskey} disabled={loading}>
              <span className="flex items-center justify-center gap-2">
                <Fingerprint size={18} />
                {loading ? 'Creating your wallet…' : 'Create my wallet'}
              </span>
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
