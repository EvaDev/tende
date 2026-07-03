import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export interface Icon {
  icon_id: number;
  name: string;
  slug: string;
  mime_type: string;
  arweave_id: string | null;
}

let cache: Icon[] | null = null;

export function useIcons() {
  const [icons, setIcons] = useState<Icon[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (cache) return;
    apiFetch<Icon[]>('/api/admin/icons')
      .then((data) => { cache = data; setIcons(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { icons, loading };
}
