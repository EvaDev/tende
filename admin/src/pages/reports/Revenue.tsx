import { Fragment } from 'react';
import { Section, useReport, ReportState, shortHash } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface Revenue { currency: string; platformCut: string; platformCutDisplay: string; harvests: number }
interface ConvFee { feeCurrency: string; conversions: number; totalFee: string; totalConverted: string }

interface GasCategoryRow {
  category: string;
  source?: string;
  label: string;
  count: number;
  totalEth: number;
  totalZar?: number;
  zarPerTx?: number;
  lastZar?: number;
}

interface GasGroup {
  group: string;
  label: string;
  count: number;
  totalEth: number;
  totalZar: number;
  zarPerTx: number;
  lastZar?: number;
  rows: GasCategoryRow[];
}

interface GasFees {
  totalEth: number;
  totalZar?: number;
  ethUsd?: number | null;
  usdPerZar?: number | null;
  transactionCount: number;
  byCategory: GasCategoryRow[];
  byGroup?: GasGroup[];
  bySource: { source: string; label?: string; category: string; count: number; totalEth: number; totalZar?: number; zarPerTx?: number; lastZar?: number }[];
  recent: {
    txHash: string; source: string; label?: string; category: string;
    gasUsed: number; costEth: number; costZar?: number;
    blockNumber: number | null; recordedAt: string;
  }[];
}

const feeCols: Col<ConvFee>[] = [
  { key: 'currency', header: 'Fee currency', sort: r => r.feeCurrency, render: r => r.feeCurrency },
  { key: 'conversions', header: 'Conversions', sort: r => r.conversions, render: r => r.conversions.toLocaleString() },
  { key: 'converted', header: 'Total converted', sort: r => Number(r.totalConverted),
    render: r => `R${Number(r.totalConverted).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
  { key: 'fees', header: 'Total fees', sort: r => Number(r.totalFee),
    render: r => `R${Number(r.totalFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
];

const revCols: Col<Revenue>[] = [
  { key: 'currency', header: 'Currency', sort: r => r.currency, render: r => r.currency },
  { key: 'cut', header: 'Platform revenue', sort: r => Number(r.platformCut),
    render: r => {
      const sym = r.currency === 'USDC' || r.currency === 'USD' ? '$' : r.currency === 'ZAR' ? 'R' : '';
      return `${sym}${r.platformCutDisplay}`;
    }, className: 'tabular-nums' },
  { key: 'harvests', header: 'Harvests', sort: r => r.harvests, render: r => r.harvests.toLocaleString() },
];

function formatZar(zar: number | undefined | null): string {
  if (zar == null || !Number.isFinite(zar)) return '—';
  return `R${zar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function GroupedGasCategoryTable({ groups }: { groups: GasGroup[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Transactions</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide tabular-nums">Total gas</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide tabular-nums">Rand value</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide tabular-nums">R / tx</th>
            <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide tabular-nums">Last R / tx</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {groups.map(g => (
            <Fragment key={g.group}>
              <tr className="bg-gray-50/80">
                <td className="px-4 py-3 font-medium text-gray-900">{g.label}</td>
                <td className="px-4 py-3 tabular-nums">{g.count.toLocaleString()}</td>
                <td className="px-4 py-3 tabular-nums">{g.totalEth.toFixed(6)} ETH</td>
                <td className="px-4 py-3 tabular-nums">{formatZar(g.totalZar)}</td>
                <td className="px-4 py-3 tabular-nums">{formatZar(g.zarPerTx)}</td>
                <td className="px-4 py-3 tabular-nums">{formatZar(g.lastZar)}</td>
              </tr>
              {g.rows.map(r => (
                <tr key={`${g.group}-${r.source ?? r.label}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 pl-10 text-gray-700">{r.label}</td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-700">{r.count.toLocaleString()}</td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-700">{r.totalEth.toFixed(6)} ETH</td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-700">{formatZar(r.totalZar)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-700">{formatZar(r.zarPerTx)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-gray-700">{r.count > 0 ? formatZar(r.lastZar) : '—'}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const gasSourceCols: Col<GasFees['bySource'][0]>[] = [
  { key: 'source', header: 'Source', sort: r => r.label ?? r.source, render: r => r.label ?? r.source },
  { key: 'category', header: 'Category', sort: r => r.category, render: r => r.category },
  { key: 'count', header: 'Transactions', sort: r => r.count, render: r => r.count.toLocaleString() },
  { key: 'eth', header: 'Total gas', sort: r => r.totalEth,
    render: r => `${r.totalEth.toFixed(6)} ETH`, className: 'tabular-nums' },
  { key: 'zar', header: 'Rand value', sort: r => r.totalZar ?? 0,
    render: r => formatZar(r.totalZar), className: 'tabular-nums' },
  { key: 'rpt', header: 'R / tx', sort: r => r.zarPerTx ?? 0,
    render: r => formatZar(r.zarPerTx), className: 'tabular-nums' },
  { key: 'last', header: 'Last R / tx', sort: r => r.lastZar ?? 0,
    render: r => r.count > 0 ? formatZar(r.lastZar) : '—', className: 'tabular-nums' },
];

const gasRecentCols: Col<GasFees['recent'][0]>[] = [
  { key: 'when', header: 'Recorded', sort: r => r.recordedAt, render: r => new Date(r.recordedAt).toLocaleString() },
  { key: 'category', header: 'Category', sort: r => r.category, render: r => r.category },
  { key: 'source', header: 'Source', sort: r => r.label ?? r.source, render: r => r.label ?? r.source },
  { key: 'gas', header: 'Gas used', sort: r => r.gasUsed, render: r => r.gasUsed.toLocaleString(), className: 'tabular-nums' },
  { key: 'cost', header: 'Cost', sort: r => r.costEth, render: r => `${r.costEth.toFixed(6)} ETH`, className: 'tabular-nums' },
  { key: 'zar', header: 'Rand value', sort: r => r.costZar ?? 0,
    render: r => formatZar(r.costZar), className: 'tabular-nums' },
  { key: 'tx', header: 'Tx', render: r => <span className="font-mono text-[11px]">{shortHash(r.txHash)}</span> },
];

function formatEthApprox(eth: number): string {
  return `~${eth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH`;
}

interface SettlementFee { currency: string; settlements: number; totalFee: string; totalGross: string }
interface WithdrawalFee {
  currency: string;
  withdrawals: number;
  totalFee: string;
  totalNet: string;
  totalGross: string;
}

const settlementFeeCols: Col<SettlementFee>[] = [
  { key: 'currency', header: 'Currency', sort: r => r.currency, render: r => r.currency },
  { key: 'settlements', header: 'Settlements', sort: r => r.settlements, render: r => r.settlements.toLocaleString() },
  { key: 'gross', header: 'Total settled', sort: r => Number(r.totalGross),
    render: r => `R${Number(r.totalGross).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
  { key: 'fees', header: 'Platform fees', sort: r => Number(r.totalFee),
    render: r => `R${Number(r.totalFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
];

const withdrawalFeeCols: Col<WithdrawalFee>[] = [
  { key: 'currency', header: 'Currency', sort: r => r.currency, render: r => r.currency },
  { key: 'withdrawals', header: 'Withdrawals', sort: r => r.withdrawals, render: r => r.withdrawals.toLocaleString() },
  { key: 'gross', header: 'Gross withdrawn', sort: r => Number(r.totalGross),
    render: r => `$${Number(r.totalGross).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
  { key: 'net', header: 'Net left ecosystem', sort: r => Number(r.totalNet),
    render: r => `$${Number(r.totalNet).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
  { key: 'fees', header: 'Platform fees', sort: r => Number(r.totalFee),
    render: r => `$${Number(r.totalFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
];

export default function Revenue() {
  const { data, loading, error } = useReport<Revenue[]>('/api/admin/reports/revenue');
  const fees = useReport<ConvFee[]>('/api/admin/reports/conversion-fees');
  const settlementFees = useReport<SettlementFee[]>('/api/admin/reports/settlement-fees');
  const withdrawalFees = useReport<WithdrawalFee[]>('/api/admin/reports/withdrawal-fees');
  const gas = useReport<GasFees>('/api/admin/reports/gas-fees');

  return (
    <div className="space-y-8">
      <Section title="Conversion fees (FX spread)">
        <p className="text-sm text-gray-600">
          Platform revenue from currency conversions (e.g. ZAR→USD). The consumer is debited the full
          amount and credited the post-spread amount; the spread is retained in the reserve and
          recorded per conversion. Rate: Settings → Revenue → FX conversion spread.
        </p>
        <ReportState loading={fees.loading} error={fees.error} empty={!fees.loading && !fees.error && fees.data?.length === 0} />
        {fees.data && fees.data.length > 0 && (
          <SortableTable cols={feeCols} rows={fees.data} initialSort={{ key: 'fees', dir: 'desc' }} />
        )}
      </Section>

      <Section title="Merchant settlement fees">
        <p className="text-sm text-gray-600">
          Platform fee retained when merchants settle vault balance to fiat. Full token amount is
          withdrawn; the operator pays the net amount to the merchant&apos;s bank. Rate: Settings → Revenue → Merchant settlement fee.
        </p>
        <ReportState loading={settlementFees.loading} error={settlementFees.error}
          empty={!settlementFees.loading && !settlementFees.error && settlementFees.data?.length === 0} />
        {settlementFees.data && settlementFees.data.length > 0 && (
          <SortableTable cols={settlementFeeCols} rows={settlementFees.data} initialSort={{ key: 'fees', dir: 'desc' }} />
        )}
      </Section>

      <Section title="Withdrawal fees (external send)">
        <p className="text-sm text-gray-600">
          Platform fee retained when consumers withdraw USDC to an external wallet. Net amount leaves
          the vault/ecosystem; the fee stays as a platform USDC claim. Rate: Settings → Revenue → Withdrawal fee.
        </p>
        <ReportState loading={withdrawalFees.loading} error={withdrawalFees.error}
          empty={!withdrawalFees.loading && !withdrawalFees.error && withdrawalFees.data?.length === 0} />
        {withdrawalFees.data && withdrawalFees.data.length > 0 && (
          <SortableTable cols={withdrawalFeeCols} rows={withdrawalFees.data} initialSort={{ key: 'fees', dir: 'desc' }} />
        )}
      </Section>

      <Section title="Protocol revenue (vault yield)">
        <p className="text-sm text-gray-600">
          The platform’s share of harvested vault yield (<code>YieldHarvested.platformCut</code>) by
          currency — real tokens swept to the platform treasury. For USDC, consumer USD balances are
          flat 1:1 so the harvest fee is 100% to the protocol; for ZAR backing, the default is 10%
          to the protocol and the rest lifts holder balances via price-per-share.
        </p>
        <ReportState loading={loading} error={error} empty={!loading && !error && data?.length === 0} />
        {data && data.length > 0 && (
          <SortableTable cols={revCols} rows={data} initialSort={{ key: 'cut', dir: 'desc' }} />
        )}
      </Section>

      <Section title="Protocol expenses (gas)">
        <p className="text-sm text-gray-600">
          Total ETH spent by the platform (backend relayer + deployer admin wallet), grouped by{' '}
          <strong>consumer transactions</strong> (passkey / session / session setup),{' '}
          <strong>customer acquisition</strong>, <strong>platform operations</strong>, and{' '}
          <strong>contract deployments</strong>. Rand values use the live ETH/USD Uniswap quote and ZAR/USD FX rate;
          R / tx is average Rand ÷ count; Last R / tx is the most recent tx in that row.
          Session payments are split by fulfilment outcome (refunded / failed = unsuccessful).
        </p>
        {gas.data && (
          <p className="text-lg font-semibold text-brand-accent tabular-nums">
            Total: {formatEthApprox(gas.data.totalEth)}
            {gas.data.totalZar != null && gas.data.totalZar > 0 && (
              <span className="ml-2">({formatZar(gas.data.totalZar)})</span>
            )}
            <span className="text-sm font-normal text-gray-500 ml-2">
              ({gas.data.transactionCount.toLocaleString()} transaction{gas.data.transactionCount === 1 ? '' : 's'})
            </span>
          </p>
        )}
        <ReportState loading={gas.loading} error={gas.error} empty={!gas.loading && !gas.error && gas.data?.transactionCount === 0} />
        {gas.data && (gas.data.byGroup?.length ?? 0) > 0 && (
          <>
            <h4 className="text-sm font-medium text-gray-700 mt-4">By category</h4>
            <GroupedGasCategoryTable groups={gas.data.byGroup!} />
          </>
        )}
        {gas.data && !gas.data.byGroup?.length && gas.data.byCategory.length > 0 && (
          <>
            <h4 className="text-sm font-medium text-gray-700 mt-4">By category</h4>
            <GroupedGasCategoryTable groups={[{
              group: 'all',
              label: 'All',
              count: gas.data.byCategory.reduce((s, r) => s + r.count, 0),
              totalEth: gas.data.byCategory.reduce((s, r) => s + r.totalEth, 0),
              totalZar: gas.data.byCategory.reduce((s, r) => s + (r.totalZar ?? 0), 0),
              zarPerTx: 0,
              rows: gas.data.byCategory,
            }]} />
          </>
        )}
        {gas.data && gas.data.bySource.length > 0 && (
          <>
            <h4 className="text-sm font-medium text-gray-700 mt-4">By source</h4>
            <SortableTable cols={gasSourceCols} rows={gas.data.bySource} initialSort={{ key: 'eth', dir: 'desc' }} />
          </>
        )}
        {gas.data && gas.data.recent.length > 0 && (
          <>
            <h4 className="text-sm font-medium text-gray-700 mt-4">Recent transactions</h4>
            <SortableTable cols={gasRecentCols} rows={gas.data.recent} initialSort={{ key: 'when', dir: 'desc' }} />
          </>
        )}
      </Section>
    </div>
  );
}
