import { cn } from '@/lib/utils';

export function Badge({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', className)} {...p} />;
}
