import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

interface RegField {
  field_key: string; label: string;
  included: boolean; required: boolean;
  verification_method: string; sort_order: number;
}

const VERIFICATION_OPTIONS = [
  { value: 'none',          label: 'None (collected but not verified)' },
  { value: 'otp_sms',       label: 'OTP via SMS' },
  { value: 'manual_review', label: 'Manual review by admin' },
  { value: 'idos',          label: 'idOS credential' },
];

// Fields that are always mandatory and cannot be disabled
const LOCKED_FIELDS = new Set(['account_tag']);

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-brand-accent' : 'bg-gray-200'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export default function Registration() {
  const [fields, setFields] = useState<RegField[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved,  setSaved]  = useState<string | null>(null);

  function load() {
    apiFetch<RegField[]>('/api/admin/registration-fields').then(setFields).catch(() => {});
  }
  useEffect(load, []);

  async function patch(key: string, update: Partial<RegField>) {
    setSaving(key);
    try {
      const updated = await apiFetch<RegField>(`/api/admin/registration-fields/${key}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      });
      setFields(prev => prev.map(f => f.field_key === key ? updated : f));
      setSaved(key);
      setTimeout(() => setSaved(null), 1500);
    } catch {
      // revert optimistic update
      load();
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold text-brand-accent">Registration Flow</h2>
        <p className="text-sm text-gray-500 mt-1">
          Control which fields appear during consumer sign-up. Disabled fields are skipped entirely.
          Fields marked <strong>Required</strong> must be filled before the consumer can proceed.
        </p>
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Field', 'Show in Flow', 'Required', 'Verification Method', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {fields.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
            )}
            {fields.map(f => {
              const locked = LOCKED_FIELDS.has(f.field_key);
              return (
                <tr key={f.field_key} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{f.label}</p>
                    <p className="text-xs text-gray-400 font-mono">{f.field_key}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Toggle
                      checked={f.included}
                      disabled={locked}
                      onChange={v => patch(f.field_key, { included: v, required: v ? f.required : false })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Toggle
                      checked={f.required}
                      disabled={!f.included || locked}
                      onChange={v => patch(f.field_key, { required: v })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={f.verification_method}
                      disabled={!f.included}
                      onChange={e => patch(f.field_key, { verification_method: e.target.value })}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand-accent/50"
                    >
                      {VERIFICATION_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {saving === f.field_key && <span className="text-gray-400">Saving…</span>}
                    {saved  === f.field_key && <span className="text-green-600">✓ Saved</span>}
                    {locked && <span className="text-gray-400 italic">Always on</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 space-y-1">
        <p className="font-semibold">OTP via SMS not yet wired up</p>
        <p>Setting verification to "OTP via SMS" records the intent but the consumer flow will treat it as unverified until an SMS gateway is configured. Mobile and Full Name are marked as non-verified for now.</p>
      </div>
    </div>
  );
}
