import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import { useAppName } from '@/hooks/useAppConfig';

interface SegmentBalance {
  currency: string;
  token: string | null;
  amount: string;
  amountValue: number;
}

interface SegmentMetrics {
  tvl: SegmentBalance[];
  held: SegmentBalance[];
}

interface VaultClaims {
  consumers: SegmentMetrics;
  merchants: SegmentMetrics;
  totalHeld: SegmentBalance[];
  pendingSettlements: { count: number; totalZar: string };
}

interface TreasurySummary {
  totalTreasuryDisplay: string;
  ttzaOutstandingDisplay: string;
  vaultUsdcDisplay: string;
  platformTtzaDisplay: string;
}

interface ProtocolFinancials {
  revenueDisplay: string;
  conversionFeesDisplay: string;
  conversionCount: number;
  yieldRevenueDisplay: string;
  yieldHarvestDue: boolean;
  settlementFeesDisplay: string;
  settlementCount: number;
  withdrawalFeesDisplay?: string;
  withdrawalCount?: number;
  withdrawalNetDisplay?: string;
  expensesDisplay: string;
  cacExpensesDisplay: string;
  cacCount: number;
  cacPerConsumerDisplay: string;
  transactionGasDisplay: string;
  transactionCount: number;
  operationsGasDisplay: string;
  operationsCount: number;
  deploymentGasDisplay: string;
  deploymentCount: number;
  netDisplay: string;
  tradingSinceDisplay: string;
  usdPerZar: number | null;
}

interface WithdrawalSummary {
  count: number;
  netUsdc: number;
  feeUsdc: number;
  netDisplay: string;
  feeDisplay: string;
  grossDisplay: string;
}

const DETAIL_TEXT = 'text-lg text-white/70';
const DETAIL_COUNT = 'text-lg text-white/70';

function DetailFooter({ rows, lines }: { rows?: { label: string; count?: string; value: string }[]; lines?: string[] }) {
  if (!rows?.length && !lines?.length) return null;
  return (
    <div className="flex flex-col gap-0.5 mt-4 pt-3 border-t border-white/10">
      {rows?.map(row => {
        const harvestDue = row.count === 'Harvest due';
        return (
          <div key={row.label} className={`grid grid-cols-[1fr_auto_auto] gap-x-4 ${DETAIL_TEXT} tabular-nums items-baseline`}>
            <span>{row.label}</span>
            <span className={`text-right min-w-[5rem] ${harvestDue ? 'text-amber-200 font-semibold' : DETAIL_COUNT}`}>
              {row.count ?? ''}
            </span>
            <span className="text-right min-w-[5.5rem]">{row.value}</span>
          </div>
        );
      })}
      {lines?.map(line => (
        <span key={line} className={`${DETAIL_TEXT} tabular-nums`}>{line}</span>
      ))}
    </div>
  );
}

function FinMetricTile({
  label,
  total,
  path,
  footerRows,
  singleLineHeader,
  onNavigate,
}: {
  label: string;
  total: string;
  path: string;
  footerRows?: { label: string; count?: string; value: string }[];
  singleLineHeader?: boolean;
  onNavigate: (path: string) => void;
}) {
  if (singleLineHeader) {
    return (
      <div className={`${TILE} flex flex-col justify-between`} onClick={() => onNavigate(path)}>
        <div className="flex justify-between items-center gap-4">
          <span className="text-lg text-white/70">{label}</span>
          <span className="text-5xl font-bold tabular-nums leading-none">{total}</span>
        </div>
        <DetailFooter rows={footerRows} />
      </div>
    );
  }
  return (
    <MetricTile
      label={label}
      path={path}
      alignLabelWithCount
      rightAmount={total}
      footerRows={footerRows}
      onNavigate={onNavigate}
    />
  );
}

interface Counts {
  merchants: number;
  consumers: number;
  products: number;
  countries: number;
  currencies: number;
  pendingKyc: number;
  vaultClaims: VaultClaims | null;
  financials: ProtocolFinancials | null;
  treasurySummary: TreasurySummary | null;
  withdrawals: WithdrawalSummary | null;
  escrowUsdc: number;
  totalSalesDisplay: string | null;
}

const TILE = 'bg-brand-accent text-white rounded-xl p-8 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg select-none min-h-[10rem]';

const SYM: Record<string, string> = { ZAR: 'R', USD: '$', USDC: '$' };
const sym = (c: string) => SYM[c] ?? c;

function formatHeld(rows: SegmentBalance[], useToken = false): string {
  if (!rows.length) return '0';
  const parts = rows.map(r => {
    const code = useToken ? (r.token ?? r.currency) : r.currency;
    return `${sym(code)}${Math.round(r.amountValue)}`;
  });
  return parts.join(' · ');
}

function usdcHeldValue(rows: SegmentBalance[]): number {
  return rows
    .filter(r => r.token === 'USDC' || r.currency === 'USD')
    .reduce((s, r) => s + r.amountValue, 0);
}

function zarTvlValue(rows: SegmentBalance[]): number {
  return rows
    .filter(r => r.currency === 'ZAR' || r.token === 'TTZA')
    .reduce((s, r) => s + r.amountValue, 0);
}

function fmtZarInt(n: number): string {
  return `R${Math.round(n).toLocaleString()}`;
}

function fmtUsdInt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function MetricTile({
  label,
  path,
  count,
  rightAmount,
  rightLabel,
  footerLines,
  footerRows,
  alignLabelWithCount,
  onNavigate,
}: {
  label: string;
  path: string;
  count?: number;
  rightAmount?: string;
  rightLabel?: string;
  footerLines?: string[];
  footerRows?: { label: string; count?: string; value: string }[];
  alignLabelWithCount?: boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className={`${TILE} flex flex-col justify-between`} onClick={() => onNavigate(path)}>
      <div className="flex justify-between items-end gap-4">
        <div className="flex flex-col gap-2 min-w-0">
          {count != null && <span className="text-5xl font-bold">{count}</span>}
          {alignLabelWithCount && count == null && (
            <span className="text-5xl font-bold invisible select-none" aria-hidden>0</span>
          )}
          <span className={`text-lg text-white/70 ${count == null && !alignLabelWithCount ? 'text-2xl font-semibold text-white' : ''}`}>{label}</span>
        </div>
        {rightAmount != null && (
          <div className="flex flex-col gap-2 items-end text-right shrink-0">
            <span className="text-5xl font-bold tabular-nums leading-none">{rightAmount}</span>
            {rightLabel ? (
              <span className="text-lg text-white/70">{rightLabel}</span>
            ) : alignLabelWithCount ? (
              <span className="text-lg text-white/70 invisible select-none" aria-hidden>Sales</span>
            ) : null}
          </div>
        )}
      </div>
      {(footerRows?.length || footerLines?.length) ? (
        <DetailFooter rows={footerRows} lines={footerLines} />
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const appName = useAppName();
  const [counts, setCounts] = useState<Counts>({
    merchants: 0, consumers: 0, products: 0, countries: 0, currencies: 0, pendingKyc: 0,
    vaultClaims: null, financials: null, treasurySummary: null, withdrawals: null, escrowUsdc: 0, totalSalesDisplay: null,
  });

  useEffect(() => {
    Promise.all([
      apiFetch<{
        merchants: number; consumers: number; pendingKyc: number;
        vaultClaims: VaultClaims | null; financials: ProtocolFinancials | null;
        treasurySummary: TreasurySummary | null; withdrawals: WithdrawalSummary | null;
        escrowUsdc?: number; totalSalesDisplay: string | null;
      }>('/api/admin/stats'),
      apiFetch<unknown[]>('/api/admin/countries'),
      apiFetch<unknown[]>('/api/admin/currencies'),
      apiFetch<unknown[]>('/api/admin/products'),
    ]).then(([stats, countries, currencies, products]) => {
      setCounts({
        merchants:  stats.merchants,
        consumers:  stats.consumers,
        pendingKyc: stats.pendingKyc,
        vaultClaims: stats.vaultClaims,
        financials: stats.financials,
        treasurySummary: stats.treasurySummary,
        withdrawals: stats.withdrawals,
        escrowUsdc: stats.escrowUsdc ?? 0,
        totalSalesDisplay: stats.totalSalesDisplay,
        countries:  countries.length,
        currencies: currencies.length,
        products:   products.length,
      });
    }).catch(() => {});
  }, []);

  const claims = counts.vaultClaims;
  const fin = counts.financials;
  const treasury = counts.treasurySummary;

  const consumerUsdc = claims ? usdcHeldValue(claims.consumers.held) : 0;
  const consumerZarTvl = claims ? zarTvlValue(claims.consumers.tvl) : 0;
  const consumerTotalZar = fin?.usdPerZar && fin.usdPerZar > 0
    ? consumerZarTvl + consumerUsdc / fin.usdPerZar
    : consumerZarTvl;
  const merchantUsdc = claims ? usdcHeldValue(claims.merchants.held) : 0;
  const vaultUsdcTotal = treasury
    ? Number(treasury.vaultUsdcDisplay.replace(/[^0-9.]/g, ''))
    : consumerUsdc + merchantUsdc;
  const platformUsdc = Math.max(0, vaultUsdcTotal - consumerUsdc - merchantUsdc);
  const withdrawnUsdc = counts.withdrawals?.netUsdc ?? 0;
  const escrowUsdc = counts.escrowUsdc ?? 0;
  const totalUsdcHeld = consumerUsdc + merchantUsdc + platformUsdc;

  const consumerAppUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:5174'
    : window.location.origin.replace('admin.', '');

  return (
    <div className="space-y-8">
      {fin && (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-5">
          <FinMetricTile
            label="Revenue"
            total={fin.revenueDisplay}
            path="/reports/revenue"
            footerRows={[
              { label: 'Conversions', count: String(fin.conversionCount), value: fin.conversionFeesDisplay },
              { label: 'Yield', count: fin.yieldHarvestDue ? 'Harvest due' : '—', value: fin.yieldRevenueDisplay },
              { label: 'Settlement', count: String(fin.settlementCount), value: fin.settlementFeesDisplay },
              { label: 'Withdrawals', count: String(fin.withdrawalCount ?? 0), value: fin.withdrawalFeesDisplay ?? 'R0.00' },
            ]}
            onNavigate={navigate}
          />
          <FinMetricTile
            label="Expenses"
            total={fin.expensesDisplay}
            path="/reports/revenue"
            footerRows={[
              { label: 'CAC', count: String(fin.cacCount), value: fin.cacExpensesDisplay },
              { label: 'Transactions', count: String(fin.transactionCount), value: fin.transactionGasDisplay },
              { label: 'Platform', count: String(fin.operationsCount), value: fin.operationsGasDisplay },
              { label: 'Deployments', count: String(fin.deploymentCount), value: fin.deploymentGasDisplay },
            ]}
            onNavigate={navigate}
          />
          <FinMetricTile
            label="Net P/L"
            total={fin.netDisplay}
            path="/reports/revenue"
            singleLineHeader
            footerRows={fin.tradingSinceDisplay ? [{ label: fin.tradingSinceDisplay, value: '' }] : undefined}
            onNavigate={navigate}
          />
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-5">
        <MetricTile count={counts.countries} label="Countries" path="/countries" onNavigate={navigate} />
        <MetricTile
          count={counts.merchants}
          label="Merchants"
          path="/merchants"
          rightAmount={claims ? formatHeld(claims.merchants.tvl) : undefined}
          rightLabel="Total held"
          onNavigate={navigate}
        />
        <MetricTile
          count={counts.consumers}
          label="Consumers"
          path="/consumers"
          rightAmount={claims ? fmtZarInt(consumerTotalZar) : undefined}
          rightLabel="Total held"
          footerRows={claims ? [
            { label: 'TT (ZAR)', value: fmtZarInt(consumerZarTvl) },
            { label: 'Assets (USDC)', value: fmtUsdInt(consumerUsdc) },
            { label: `${counts.pendingKyc} pending KYC`, value: '' },
            ...(fin?.cacPerConsumerDisplay ? [{ label: 'CAC per consumer', value: fin.cacPerConsumerDisplay }] : []),
          ] : undefined}
          onNavigate={navigate}
        />
        <MetricTile
          count={counts.currencies}
          label="Currencies"
          path="/currencies"
          rightAmount={claims ? fmtUsdInt(totalUsdcHeld) : undefined}
          rightLabel="Total held"
          footerRows={claims ? [
            { label: 'Consumers', value: fmtUsdInt(consumerUsdc) },
            { label: 'Merchants', value: fmtUsdInt(merchantUsdc) },
            { label: 'Platform', value: fmtUsdInt(platformUsdc) },
            ...(escrowUsdc > 0
              ? [{ label: '└ Escrow', value: fmtUsdInt(escrowUsdc) }]
              : []),
            { label: 'Withdrawals (out)', value: fmtUsdInt(withdrawnUsdc) },
          ] : undefined}
          onNavigate={navigate}
        />
        <MetricTile
          count={counts.products}
          label="Products"
          path="/products"
          rightAmount={counts.totalSalesDisplay ?? undefined}
          rightLabel="Sales"
          onNavigate={navigate}
        />
        <MetricTile
          label="Vault"
          path="/treasury"
          alignLabelWithCount
          rightAmount={treasury?.totalTreasuryDisplay}
          footerRows={treasury ? [
            { label: 'Minted', value: treasury.ttzaOutstandingDisplay },
            { label: 'Platform', value: treasury.platformTtzaDisplay },
            { label: 'Assets', value: treasury.vaultUsdcDisplay },
          ] : [{ label: 'Loading…', value: '' }]}
          onNavigate={navigate}
        />
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
