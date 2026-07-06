import { Section, useReport, ReportState, shortHash } from './_shared';
import { SortableTable, type Col } from '@/components/SortableTable';

interface Revenue { currency: string; platformCut: string; platformCutDisplay: string; harvests: number }
interface ConvFee { feeCurrency: string; conversions: number; totalFee: string; totalConverted: string }
interface GasFees {
  totalEth: number;
  transactionCount: number;
  byCategory: { category: string; label: string; count: number; totalEth: number }[];
  bySource: { source: string; category: string; count: number; totalEth: number }[];
  recent: { txHash: string; source: string; category: string; gasUsed: number; costEth: number; blockNumber: number | null; recordedAt: string }[];
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

const gasCategoryCols: Col<GasFees['byCategory'][0]>[] = [
  { key: 'label', header: 'Category', sort: r => r.label, render: r => r.label },
  { key: 'count', header: 'Transactions', sort: r => r.count, render: r => r.count.toLocaleString() },
  { key: 'eth', header: 'Total gas', sort: r => r.totalEth,
    render: r => `${r.totalEth.toFixed(6)} ETH`, className: 'tabular-nums' },
];

const gasSourceCols: Col<GasFees['bySource'][0]>[] = [
  { key: 'source', header: 'Source', sort: r => r.source, render: r => r.source },
  { key: 'category', header: 'Category', sort: r => r.category, render: r => r.category },
  { key: 'count', header: 'Transactions', sort: r => r.count, render: r => r.count.toLocaleString() },
  { key: 'eth', header: 'Total gas', sort: r => r.totalEth,
    render: r => `${r.totalEth.toFixed(6)} ETH`, className: 'tabular-nums' },
];

const gasRecentCols: Col<GasFees['recent'][0]>[] = [
  { key: 'when', header: 'Recorded', sort: r => r.recordedAt, render: r => new Date(r.recordedAt).toLocaleString() },
  { key: 'category', header: 'Category', sort: r => r.category, render: r => r.category },
  { key: 'source', header: 'Source', sort: r => r.source, render: r => r.source },
  { key: 'gas', header: 'Gas used', sort: r => r.gasUsed, render: r => r.gasUsed.toLocaleString(), className: 'tabular-nums' },
  { key: 'cost', header: 'Cost', sort: r => r.costEth, render: r => `${r.costEth.toFixed(6)} ETH`, className: 'tabular-nums' },
  { key: 'tx', header: 'Tx', render: r => <span className="font-mono text-[11px]">{shortHash(r.txHash)}</span> },
];

function formatEthApprox(eth: number): string {
  return `~${eth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH`;
}

interface SettlementFee { currency: string; settlements: number; totalFee: string; totalGross: string }

const settlementFeeCols: Col<SettlementFee>[] = [
  { key: 'currency', header: 'Currency', sort: r => r.currency, render: r => r.currency },
  { key: 'settlements', header: 'Settlements', sort: r => r.settlements, render: r => r.settlements.toLocaleString() },
  { key: 'gross', header: 'Total settled', sort: r => Number(r.totalGross),
    render: r => `R${Number(r.totalGross).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
  { key: 'fees', header: 'Platform fees', sort: r => Number(r.totalFee),
    render: r => `R${Number(r.totalFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, className: 'tabular-nums' },
];

export default function Revenue() {
  const { data, loading, error } = useReport<Revenue[]>('/api/admin/reports/revenue');
  const fees = useReport<ConvFee[]>('/api/admin/reports/conversion-fees');
  const settlementFees = useReport<SettlementFee[]>('/api/admin/reports/settlement-fees');
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
          Total ETH spent by the platform (backend relayer + deployer admin wallet).{' '}
          <strong>Customer acquisition</strong> covers consumer onboarding (Safe deploy, passkey signer).{' '}
          <strong>Consumer transactions</strong> are payment relays.{' '}
          <strong>Platform operations</strong> includes settlements, treasury, and conversions.{' '}
          <strong>Contract deployments</strong> are UUPS proxy deploys and upgrades.
        </p>
        {gas.data && (
          <p className="text-lg font-semibold text-brand-accent tabular-nums">
            Total: {formatEthApprox(gas.data.totalEth)}
            <span className="text-sm font-normal text-gray-500 ml-2">
              ({gas.data.transactionCount.toLocaleString()} transaction{gas.data.transactionCount === 1 ? '' : 's'})
            </span>
          </p>
        )}
        <ReportState loading={gas.loading} error={gas.error} empty={!gas.loading && !gas.error && gas.data?.transactionCount === 0} />
        {gas.data && gas.data.byCategory.length > 0 && (
          <>
            <h4 className="text-sm font-medium text-gray-700 mt-4">By category</h4>
            <SortableTable cols={gasCategoryCols} rows={gas.data.byCategory} initialSort={{ key: 'eth', dir: 'desc' }} />
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
