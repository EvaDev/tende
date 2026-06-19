import { useRef, useEffect } from 'react';
import { Delete } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export default function PinPad({ value, onChange, maxLength = 5 }: Props) {
  // Keep a ref in sync with the prop so press() always reads the latest value
  // even when multiple clicks arrive before React re-renders.
  const current = useRef(value);
  useEffect(() => { current.current = value; }, [value]);

  function press(k: string) {
    if (k === '⌫') {
      const next = current.current.slice(0, -1);
      current.current = next;
      onChange(next);
      return;
    }
    if (!k) return;
    if (current.current.length < maxLength) {
      const next = current.current + k;
      current.current = next;
      onChange(next);
    }
  }

  return (
    <div className="space-y-6">
      {/* Dots */}
      <div className="flex justify-center gap-4">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-colors ${
              i < value.length ? 'bg-brand-green border-brand-green' : 'border-brand-muted'
            }`}
          />
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-3 px-8">
        {KEYS.map((k, i) => (
          <button
            key={i}
            onClick={() => press(k)}
            disabled={!k && k !== '0'}
            className={`h-16 rounded-2xl text-xl font-semibold transition-all active:scale-95 ${
              k === '⌫'
                ? 'bg-transparent text-brand-muted flex items-center justify-center'
                : k === ''
                ? 'invisible'
                : 'bg-brand-border text-white hover:bg-brand-muted/30'
            }`}
          >
            {k === '⌫' ? <Delete size={22} /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
