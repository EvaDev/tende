import { ShoppingBag } from 'lucide-react';
import BottomNav from '@/components/BottomNav';

// Placeholder — "Buy" (airtime / goods / vouchers) is not built yet.
export default function Buy() {
  return (
    <div className="flex flex-col min-h-dvh pb-24 px-6 pt-14">
      <h1 className="text-3xl font-bold text-white">Buy</h1>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 -mt-12">
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
          <ShoppingBag size={36} className="text-white" />
        </div>
        <p className="text-white font-semibold text-lg">Coming soon</p>
        <p className="text-white text-sm max-w-xs">Buy airtime, data, vouchers and more — straight from your balance.</p>
      </div>
      <BottomNav />
    </div>
  );
}
