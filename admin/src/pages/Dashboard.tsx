import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import { useAppName } from '@/hooks/useAppConfig';

interface Counts {
  merchants: number;
  consumers: number;
  products: number;
  countries: number;
  currencies: number;
  pendingKyc: number;
}

const TILE = 'flex flex-col gap-2 bg-brand-accent text-white rounded-xl p-8 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg select-none';

export default function Dashboard() {
  const navigate = useNavigate();
  const appName = useAppName();
  const [counts, setCounts] = useState<Counts>({ merchants: 0, consumers: 0, products: 0, countries: 0, currencies: 0, pendingKyc: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ merchants: number; consumers: number; pendingKyc: number }>('/api/admin/stats'),
      apiFetch<unknown[]>('/api/admin/countries'),
      apiFetch<unknown[]>('/api/admin/currencies'),
      apiFetch<unknown[]>('/api/admin/products'),
    ]).then(([stats, countries, currencies, products]) => {
      setCounts({
        merchants:  stats.merchants,
        consumers:  stats.consumers,
        pendingKyc: stats.pendingKyc,
        countries:  countries.length,
        currencies: currencies.length,
        products:   products.length,
      });
    }).catch(() => {});
  }, []);

  const tiles = [
    { label: 'Merchants',    value: counts.merchants,  path: '/merchants'  },
    { label: 'Consumers',    value: counts.consumers,  path: '/consumers'  },
    { label: 'Products',     value: counts.products,   path: '/products'   },
    { label: 'Currencies',   value: counts.currencies, path: '/currencies' },
    { label: 'Countries',    value: counts.countries,  path: '/countries'  },
    { label: 'Pending KYC',  value: counts.pendingKyc, path: '/consumers'  },
  ];

  const consumerAppUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:5174'
    : window.location.origin.replace('admin.', '');

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-5">
        {tiles.map(({ label, value, path }) => (
          <div key={label} className={TILE} onClick={() => navigate(path)}>
            <span className="text-5xl font-bold">{value}</span>
            <span className="text-lg text-white/70">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <div className="bg-white rounded-xl shadow-sm border border-black/5 p-6 flex flex-col items-center gap-4 w-72">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(consumerAppUrl)}`}
            alt="Consumer app QR"
            className="w-48 h-48 rounded"
          />
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: `${appName} Consumer App`, url: consumerAppUrl }).catch(() => {});
              } else {
                window.open(`https://wa.me/?text=${encodeURIComponent(consumerAppUrl)}`, '_blank');
              }
            }}
            className="w-full bg-brand-accent text-white text-sm font-medium py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Share App Link
          </button>
        </div>
      </div>
    </div>
  );
}
