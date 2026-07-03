import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmt(amount: number | string, currency = 'ZAR') {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(Number(amount));
}

export function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function statusColor(status: unknown) {
  const map: Record<string, string> = {
    ACTIVE:    'bg-brand-accent/10 text-brand-accent',
    APPROVED:  'bg-brand-accent/10 text-brand-accent',
    EXECUTED:  'bg-brand-accent/10 text-brand-accent',
    PENDING:   'bg-gray-100 text-gray-600',
    INVITED:   'bg-gray-100 text-gray-600',
    REJECTED:  'bg-brand-danger/10 text-brand-danger',
    FAILED:    'bg-brand-danger/10 text-brand-danger',
    DISABLED:  'bg-brand-danger/10 text-brand-danger',
  };
  return map[String(status ?? '').toUpperCase()] ?? 'bg-gray-100 text-gray-600';
}
