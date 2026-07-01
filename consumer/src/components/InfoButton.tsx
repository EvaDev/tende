import { useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';

// A small ⓘ button that opens a details overlay — keeps rates/fees/notes off the
// main screen so the core flow stays clean and direct.
export function InfoButton({ title = 'Details', children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="More info"
        className="text-white active:scale-90 transition-transform"
      >
        <Info size={22} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center px-6" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xs bg-brand-card rounded-2xl p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <p className="font-semibold text-brand-accent">{title}</p>
              <button onClick={() => setOpen(false)} aria-label="Close"><X size={18} className="text-brand-accent/60" /></button>
            </div>
            <div className="text-sm text-brand-accent/80 space-y-2">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

export default InfoButton;
