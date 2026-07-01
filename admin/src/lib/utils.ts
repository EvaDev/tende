import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmt(amount: number | string, currency = 'ZAR') {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(Number(amount) / 100);
}

export function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Status badge styles — registered brand palette only (brand-accent for
// positive/active, brand-danger for rejected, neutral gray otherwise).
export function statusColor(status: unknown) {
  const map: Record<string, string> = {
    PENDING:   'bg-gray-100 text-gray-600',
    LEVEL_1:   'bg-brand-accent/10 text-brand-accent',
    LEVEL_2:   'bg-brand-accent/10 text-brand-accent',
    LEVEL_3:   'bg-brand-accent/10 text-brand-accent',
    REJECTED:  'bg-brand-danger/10 text-brand-danger',
    CONFIRMED: 'bg-brand-accent/10 text-brand-accent',
    ACTIVE:    'bg-brand-accent/10 text-brand-accent',
    INACTIVE:  'bg-gray-100 text-gray-600',
  };
  return map[String(status ?? '').toUpperCase()] ?? 'bg-gray-100 text-gray-600';
}
