import { useState } from 'react';

const PLACEHOLDER = (
  <div className="w-8 h-8 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-300 text-xs shrink-0">
    ?
  </div>
);

/** Merchant table avatar: uploaded logo first, then shared registry icon, then placeholder. */
export function MerchantLogo({ merchantId, iconId, name, className = 'w-8 h-8' }: {
  merchantId: string; iconId: number | null; name: string; className?: string;
}) {
  const [stage, setStage] = useState<'logo' | 'icon' | 'fail'>('logo');

  if (stage === 'fail') return PLACEHOLDER;

  const src = stage === 'logo'
    ? `/api/admin/merchants/${merchantId}/logo`
    : iconId != null ? `/api/admin/icons/${iconId}/image` : null;

  if (!src) return PLACEHOLDER;

  return (
    <img
      src={src}
      alt={name}
      className={`${className} rounded object-contain bg-white shrink-0`}
      onError={() => {
        if (stage === 'logo' && iconId != null) setStage('icon');
        else setStage('fail');
      }}
    />
  );
}
