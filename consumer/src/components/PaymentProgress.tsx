import { CheckCircle2, Loader2 } from 'lucide-react';

export interface PaymentStep {
  id: string;
  label: string;
}

interface Props {
  steps: PaymentStep[];
  currentId: string;
  title?: string;
  hint?: string;
}

export default function PaymentProgress({
  steps,
  currentId,
  title = 'Sending payment',
  hint = 'This can take up to a minute — please keep this screen open.',
}: Props) {
  const currentIdx = Math.max(0, steps.findIndex(s => s.id === currentId));
  const doneCount = currentId === 'done' ? steps.length : currentIdx;
  const pct = Math.round((doneCount / steps.length) * 100);
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 shrink-0">
          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--color-accent) / 0.12)" strokeWidth="8" />
            <circle
              cx="50" cy="50" r={r} fill="none"
              stroke="rgb(var(--color-accent))"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-brand-accent tabular-nums">
            {pct}%
          </span>
        </div>
        <div>
          <p className="font-semibold text-brand-accent">{title}</p>
          <p className="text-xs text-brand-accent/60 mt-1">{hint}</p>
        </div>
      </div>

      <ul className="space-y-2">
        {steps.map((step, i) => {
          const done = currentId === 'done' ? true : i < currentIdx;
          const active = step.id === currentId;
          return (
            <li key={step.id} className="flex items-center gap-3 text-sm">
              {done ? (
                <CheckCircle2 size={18} className="text-brand-accent shrink-0" />
              ) : active ? (
                <Loader2 size={18} className="text-brand-accent animate-spin shrink-0" />
              ) : (
                <span className="w-[18px] h-[18px] rounded-full border-2 border-brand-accent/25 shrink-0" />
              )}
              <span className={done || active ? 'text-brand-accent font-medium' : 'text-brand-accent/45'}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const PAYMENT_STEPS: PaymentStep[] = [
  { id: 'prepare', label: 'Preparing transfer' },
  { id: 'sign',    label: 'Approve with passkey' },
  { id: 'relay',   label: 'Submitting on-chain' },
  { id: 'done',    label: 'Confirmed' },
];
