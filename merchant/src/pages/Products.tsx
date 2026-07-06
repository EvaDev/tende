import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { SortableTable, type Col } from '@/components/SortableTable';
import { apiFetch } from '@/lib/api';
import { useMember } from '@/hooks/useMember';

const DELIVERY_OPTIONS = [
  { value: 'DIRECT',   label: 'In person',  hint: 'Customer at store or with agent — use Point of Sale / QR scan' },
  { value: 'VIRTUAL',  label: 'Mobile',     hint: 'Airtime, data and other VAS — delivered digitally' },
  { value: 'PHYSICAL', label: 'Physical',   hint: 'Physical goods — shipping or collection' },
  { value: 'VOUCHER',  label: 'Voucher',    hint: 'Digital change voucher — issue from POS (QR or @tag) instead of coins' },
] as const;

const deliveryLabel = (v: string) => DELIVERY_OPTIONS.find(o => o.value === v)?.label ?? v;

const SYM: Record<string, string> = { ZAR: 'R', MWK: 'MK', USD: '$', USDC: '$' };
function currencySym(code: string) { return SYM[code.toUpperCase()] ?? code; }
function fmtMoney(n: number, code: string) {
  return `${currencySym(code)}${n.toFixed(2)}`;
}

interface ProductCorridor { countryCode: string; currencyCode: string }

interface Product {
  id: string;
  name: string;
  description: string | null;
  delivery_type: string;
  is_fixed_price: boolean;
  price: number | null;
  min_price: number | null;
  max_price: number | null;
  incurs_vat: boolean;
  validity_days: number | null;
  country_code: string;
  currency_code: string;
  is_active: boolean;
}

interface FormState {
  name: string;
  description: string;
  deliveryType: string;
  currencyCode: string;
  countryCode: string;
  isFixedPrice: boolean;
  unitPrice: string;
  minPrice: string;
  maxPrice: string;
  incursVat: boolean;
  validityDays: string;
}

function emptyForm(corridor?: ProductCorridor): FormState {
  return {
    name: '', description: '', deliveryType: 'DIRECT',
    currencyCode: corridor?.currencyCode ?? 'ZAR',
    countryCode: corridor?.countryCode ?? 'ZA',
    isFixedPrice: true,
    unitPrice: '1', minPrice: '1', maxPrice: '100', incursVat: false, validityDays: '',
  };
}

function priceLabel(p: Product) {
  const cur = p.currency_code;
  if (p.is_fixed_price) {
    const unit = p.price != null ? fmtMoney(p.price, cur) : '—';
    if (p.min_price != null && p.max_price != null && (p.min_price !== p.price || p.max_price !== p.price)) {
      return `${unit} · ${fmtMoney(p.min_price, cur)}–${fmtMoney(p.max_price, cur)}`;
    }
    return unit;
  }
  if (p.min_price != null && p.max_price != null) return `${fmtMoney(p.min_price, cur)}–${fmtMoney(p.max_price, cur)}`;
  return 'Variable';
}

export default function Products() {
  const { isOrgAdmin } = useMember();
  const [rows, setRows]       = useState<Product[]>([]);
  const [corridors, setCorridors] = useState<ProductCorridor[]>([]);
  const [adding, setAdding]   = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm]       = useState<FormState>(emptyForm());
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const currencyOptions = useMemo(() => {
    const byCurrency = new Map<string, ProductCorridor[]>();
    for (const c of corridors) {
      const list = byCurrency.get(c.currencyCode) ?? [];
      list.push(c);
      byCurrency.set(c.currencyCode, list);
    }
    return [...byCurrency.entries()].map(([currencyCode, list]) => ({
      currencyCode,
      corridors: list,
      needsCountry: list.length > 1,
    }));
  }, [corridors]);

  const selectedCorridor = useMemo(() => {
    const opt = currencyOptions.find(o => o.currencyCode === form.currencyCode);
    if (!opt) return corridors[0];
    if (opt.needsCountry) {
      return opt.corridors.find(c => c.countryCode === form.countryCode) ?? opt.corridors[0];
    }
    return opt.corridors[0];
  }, [currencyOptions, corridors, form.currencyCode, form.countryCode]);

  const sym = currencySym(form.currencyCode);

  function load() {
    apiFetch<Product[]>('/api/merchant/me/products').then(setRows).catch(() => {});
  }

  function loadCorridors() {
    if (!isOrgAdmin) return;
    apiFetch<ProductCorridor[]>('/api/merchant/me/products/corridors')
      .then(c => setCorridors(c))
      .catch(() => setCorridors([]));
  }

  useEffect(() => { load(); loadCorridors(); }, [isOrgAdmin]);

  function openAdd() {
    const first = corridors[0];
    setEditing(null);
    setForm(emptyForm(first));
    setError('');
    setAdding(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? '',
      deliveryType: p.delivery_type,
      currencyCode: p.currency_code,
      countryCode: p.country_code,
      isFixedPrice: p.is_fixed_price,
      unitPrice: p.price != null ? String(p.price) : '',
      minPrice: p.min_price != null ? String(p.min_price) : '',
      maxPrice: p.max_price != null ? String(p.max_price) : '',
      incursVat: p.incurs_vat,
      validityDays: p.validity_days != null ? String(p.validity_days) : '',
    });
    setError('');
    setAdding(true);
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'currencyCode') {
        const opt = currencyOptions.find(o => o.currencyCode === v);
        if (opt && !opt.needsCountry) next.countryCode = opt.corridors[0].countryCode;
      }
      return next;
    });
  };

  async function save() {
    setError('');
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        deliveryType: form.deliveryType,
        isFixedPrice: form.isFixedPrice,
        unitPrice: form.isFixedPrice && form.unitPrice ? Number(form.unitPrice) : null,
        minPrice: form.minPrice ? Number(form.minPrice) : null,
        maxPrice: form.maxPrice ? Number(form.maxPrice) : null,
        incursVat: form.incursVat,
        validityDays: form.validityDays ? Number(form.validityDays) : null,
      };
      if (!editing) {
        body.currencyCode = form.currencyCode;
        body.countryCode = selectedCorridor?.countryCode;
      } else if (form.currencyCode !== editing.currency_code) {
        body.currencyCode = form.currencyCode;
        body.countryCode = selectedCorridor?.countryCode;
      }
      if (editing) {
        await apiFetch(`/api/merchant/me/products/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/merchant/me/products', { method: 'POST', body: JSON.stringify(body) });
      }
      setAdding(false);
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function toggleActive(p: Product) {
    if (!isOrgAdmin) return;
    await apiFetch(`/api/merchant/me/products/${p.id}`, {
      method: 'PATCH', body: JSON.stringify({ isActive: !p.is_active }),
    }).catch(() => {});
    load();
  }

  const deliveryHint = DELIVERY_OPTIONS.find(o => o.value === form.deliveryType)?.hint;
  const showCountryPick = currencyOptions.find(o => o.currencyCode === form.currencyCode)?.needsCountry;

  const cols: Col<Product>[] = [
    { key: 'name', header: 'Product',
      sort: p => p.name.toLowerCase(), search: p => p.name,
      render: p => <span className="font-medium">{p.name}</span> },
    { key: 'delivery', header: 'Delivery', sort: p => p.delivery_type,
      render: p => deliveryLabel(p.delivery_type) },
    { key: 'currency', header: 'Currency', sort: p => p.currency_code,
      render: p => p.currency_code },
    { key: 'price', header: 'Price', sort: p => p.price ?? p.min_price ?? 0,
      render: p => priceLabel(p) },
    { key: 'vat', header: 'VAT', sort: p => (p.incurs_vat ? 1 : 0),
      render: p => p.incurs_vat ? 'Yes' : 'No' },
    { key: 'status', header: 'Status', sort: p => (p.is_active ? 1 : 0),
      render: p => isOrgAdmin ? (
        <button
          type="button"
          onClick={() => toggleActive(p)}
          className={`text-xs px-2 py-1 rounded-lg ${p.is_active ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}`}
        >
          {p.is_active ? 'Active' : 'Inactive'}
        </button>
      ) : (
        <span className={`text-xs px-2 py-1 rounded-lg ${p.is_active ? 'bg-brand-accent/10 text-brand-accent' : 'bg-gray-100 text-gray-500'}`}>
          {p.is_active ? 'Active' : 'Inactive'}
        </span>
      ) },
    ...(isOrgAdmin ? [{
      key: 'actions', header: '', className: 'text-right',
      render: (p: Product) => (
        <button type="button" onClick={() => openEdit(p)} className="text-xs text-brand-accent hover:underline">Edit</button>
      ),
    } satisfies Col<Product>] : []),
  ];

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Products</h2>
          <p className="text-sm text-white/90 mt-1">
            {isOrgAdmin
              ? "Manage your catalogue. Pick the currency per product — match your stores (e.g. ZAR for ZA, MWK for MW). In-person and voucher products are used on Point of Sale."
              : "Your store's product catalogue. Contact head office to add or change products."}
          </p>
        </div>
        {isOrgAdmin && <Button size="sm" onClick={openAdd}>+ Add Product</Button>}
      </div>

      {isOrgAdmin && adding && (
        <Card className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Product name</Label>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Change Voucher, R10 Airtime" required />
            </div>
            <div className="sm:col-span-2">
              <Label>Description (optional)</Label>
              <Input value={form.description} onChange={set('description')} placeholder="Short note for your team" />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currencyCode} onChange={set('currencyCode')}>
                {currencyOptions.map(o => (
                  <option key={o.currencyCode} value={o.currencyCode}>
                    {o.currencyCode} — {currencySym(o.currencyCode)}
                  </option>
                ))}
              </Select>
              {corridors.length <= 1 && corridors[0] && (
                <p className="text-xs text-gray-500 mt-1">
                  Add stores in My Business to enable more currencies.
                </p>
              )}
            </div>
            {showCountryPick ? (
              <div>
                <Label>Country</Label>
                <Select value={form.countryCode} onChange={set('countryCode')}>
                  {currencyOptions.find(o => o.currencyCode === form.currencyCode)?.corridors.map(c => (
                    <option key={c.countryCode} value={c.countryCode}>{c.countryCode}</option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="flex items-end pb-1 text-sm text-gray-600">
                {selectedCorridor && <span>Country: {selectedCorridor.countryCode}</span>}
              </div>
            )}
            <div>
              <Label>Delivery type</Label>
              <Select value={form.deliveryType} onChange={set('deliveryType')}>
                {DELIVERY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              {deliveryHint && <p className="text-xs text-gray-500 mt-1">{deliveryHint}</p>}
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.incursVat} onChange={set('incursVat')} className="rounded" />
                VATable
              </label>
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isFixedPrice} onChange={set('isFixedPrice')} className="rounded" />
                Fixed unit price
              </label>
              <span className="text-xs text-gray-500">Off = customer chooses an amount between min and max (e.g. airtime)</span>
            </div>
            {form.isFixedPrice ? (
              <>
                <div>
                  <Label>Unit price ({sym})</Label>
                  <Input type="number" min="0" step="0.01" value={form.unitPrice} onChange={set('unitPrice')} />
                </div>
                <div>
                  <Label>Min total ({sym})</Label>
                  <Input type="number" min="0" step="0.01" value={form.minPrice} onChange={set('minPrice')} placeholder="e.g. 1 for cash out" />
                </div>
                <div>
                  <Label>Max total ({sym})</Label>
                  <Input type="number" min="0" step="0.01" value={form.maxPrice} onChange={set('maxPrice')} placeholder="e.g. 100 for cash out" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label>Min amount ({sym})</Label>
                  <Input type="number" min="0" step="0.01" value={form.minPrice} onChange={set('minPrice')} />
                </div>
                <div>
                  <Label>Max amount ({sym})</Label>
                  <Input type="number" min="0" step="0.01" value={form.maxPrice} onChange={set('maxPrice')} />
                </div>
              </>
            )}
            <div>
              <Label>Validity (days, optional)</Label>
              <Input type="number" min="0" step="1" value={form.validityDays} onChange={set('validityDays')} placeholder="Leave blank if none" />
            </div>
          </div>
          {error && <p className="text-brand-danger text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add product'}
            </Button>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <SortableTable
          cols={cols}
          rows={rows}
          initialSort={{ key: 'name', dir: 'asc' }}
          searchable
          searchPlaceholder="Search product…"
        />
      </Card>
    </div>
  );
}
