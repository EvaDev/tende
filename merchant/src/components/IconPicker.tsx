import { useState, useRef, useEffect } from 'react';
import { useIcons } from '@/hooks/useIcons';
import { cn } from '@/lib/utils';
import { ChevronDown, X } from 'lucide-react';

interface Props {
  value: number | null;
  onChange: (iconId: number | null) => void;
  className?: string;
}

export default function IconPicker({ value, onChange, className }: Props) {
  const { icons, loading } = useIcons();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = icons.find((i) => i.icon_id === value) ?? null;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = icons.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-sm text-left hover:border-brand-accent focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
      >
        {selected ? (
          <>
            <img
              src={`/api/admin/icons/${selected.icon_id}/image`}
              alt={selected.name}
              className="w-6 h-6 object-contain flex-shrink-0"
            />
            <span className="flex-1 truncate">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-gray-400">{loading ? 'Loading icons…' : 'Select icon…'}</span>
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              onKeyDown={(e) => e.key === 'Enter' && onChange(null)}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className={cn('text-gray-400 transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              type="text"
              placeholder="Search icons…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
            />
          </div>
          <div className="grid grid-cols-4 gap-1 p-2 max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="col-span-4 text-center text-xs text-gray-400 py-4">No icons match</p>
            )}
            {filtered.map((icon) => (
              <button
                key={icon.icon_id}
                type="button"
                title={icon.name}
                onClick={() => { onChange(icon.icon_id); setOpen(false); setSearch(''); }}
                className={cn(
                  'flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors',
                  value === icon.icon_id
                    ? 'border-brand-accent bg-brand-accent/10 text-brand-accent font-medium'
                    : 'border-transparent hover:border-gray-200 hover:bg-gray-50 text-gray-600',
                )}
              >
                <img
                  src={`/api/admin/icons/${icon.icon_id}/image`}
                  alt={icon.name}
                  className="w-8 h-8 object-contain"
                />
                <span className="truncate w-full text-center leading-tight">{icon.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
