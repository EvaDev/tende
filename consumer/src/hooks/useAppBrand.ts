import { useEffect, useState } from 'react';
import { getAppName, getAppLogo, loadBrandColors, subscribeAppBrand } from '@/lib/brand';

export function useAppBrand() {
  const [brand, setBrand] = useState({ name: getAppName(), logo: getAppLogo() });

  useEffect(() => {
    const sync = () => setBrand({ name: getAppName(), logo: getAppLogo() });
    const unsub = subscribeAppBrand(sync);
    loadBrandColors().then(sync);
    return unsub;
  }, []);

  return brand;
}
