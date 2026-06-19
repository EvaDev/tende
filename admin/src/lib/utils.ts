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

export function statusColor(status: string) {
  const map: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    LEVEL_1: 'bg-blue-100 text-blue-800',
    LEVEL_2: 'bg-indigo-100 text-indigo-800',
    LEVEL_3: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    CONFIRMED: 'bg-green-100 text-green-800',
    ACTIVE: 'bg-green-100 text-green-800',
    INACTIVE: 'bg-gray-100 text-gray-600',
  };
  return map[status.toUpperCase()] ?? 'bg-gray-100 text-gray-600';
}
