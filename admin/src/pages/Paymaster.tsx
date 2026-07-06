import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, api } from '@/lib/api';

interface GasWallet {
  envKey: string;
  label: string;
  purpose: string;
  address: string | null;
  balanceEth: string | null;
}

interface PaymasterInfo {
  mode: string;
  status: string;
  policy_id?: string;
  balance_eth?: string;
  sponsored_ops?: number;
  gasWallets?: GasWallet[];
  canFundSigner?: boolean;
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtEth = (v: string | null | undefined) =>
  v != null ? `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ETH` : '—';

const QUICK_AMOUNTS = ['0.05', '0.1', '0.25'];

export default function Paymaster() {
  const [info, setInfo] = useState<PaymasterInfo | null>(null);
  const [fundAmount, setFundAmount] = useState('0.1');
  const [fundBusy, setFundBusy] = useState(false);
  const [fundMsg, setFundMsg] = useState<{ text: string; ok: boolean; txHash?: string } | null>(null);

  const load = useCallback(() => {
    apiFetch<PaymasterInfo>('/api/admin/paymaster').then(setInfo).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const deployer = info?.gasWallets?.find(w => w.envKey === 'DEPLOYER_ADMIN_ADDRESS');
  const backend = info?.gasWallets?.find(w => w.envKey === 'BACKEND_SIGNER_ADDRESS');
  const isLive = info?.status === 'live';

  async function fundSigner() {
    const amt = fundAmount.trim();
    if (!(parseFloat(amt) > 0)) { setFundMsg({ text: 'Enter a positive ETH amount', ok: false }); return; }
    setFundBusy(true); setFundMsg(null);
    try {
      const r = await api.post<{ txHash: string; amountEth: string; gasWallets: GasWallet[] }>(
        '/api/admin/paymaster/fund-signer',
        { amount: amt },
      );
      setInfo(prev => prev ? { ...prev, gasWallets: r.gasWallets, canFundSigner: true } : prev);
      setFundMsg({
        text: `Sent ${Number(r.amountEth).toFixed(4)} ETH to backend signer.`,
        ok: true,
        txHash: r.txHash,
      });
      load();
    } catch (e) {
      setFundMsg({ text: (e as Error).message, ok: false });
    } finally {
      setFundBusy(false);
    }
  }

  const lastTx = fundMsg?.txHash;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-brand-accent">Paymaster</h2>

      <Card>
        <CardHeader>
          <CardTitle>Platform gas wallets</CardTitle>
        </CardHeader>
        <p className="text-sm text-gray-600 mb-4">
          Gas on Sepolia is paid from these two EOAs — not from consumer wallets. Keep both funded;
          the backend signer runs down faster (every relay, mint, and settlement).
        </p>
        <p className="text-sm text-gray-700 bg-brand-accent/5 border border-brand-accent/20 rounded-lg px-4 py-3 mb-4">
          <span className="font-semibold text-gray-900">Revenue vs gas.</span>{' '}
          Protocol revenue accrues to <code className="font-mono text-xs">DEPLOYER_ADMIN_ADDRESS</code>;
          the backend signer only spends ETH on gas.
        </p>
        <div className="space-y-4">
          {(info?.gasWallets ?? []).map(w => (
            <div key={w.envKey} className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">{w.label}</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">{w.envKey}</p>
                  <p className="text-sm text-gray-600 mt-1">{w.purpose}</p>
                </div>
                <p className="text-xl font-bold tabular-nums text-brand-accent">{fmtEth(w.balanceEth)}</p>
              </div>
              {w.address && (
                <a
                  href={`https://sepolia.etherscan.io/address/${w.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-2 font-mono text-xs text-brand-accent underline"
                  title={w.address}
                >
                  {shortAddr(w.address)}
                </a>
              )}
            </div>
          ))}
          {!info?.gasWallets?.length && (
            <p className="text-sm text-gray-400 italic">Loading wallet balances…</p>
          )}
        </div>

        <div className="mt-6 pt-5 border-t border-gray-200">
          <p className="text-sm font-medium text-gray-900 mb-1">Top up backend signer</p>
          <p className="text-xs text-gray-500 mb-3">
            Send ETH from deployer ({deployer?.address ? shortAddr(deployer.address) : '…'}) to backend signer
            ({backend?.address ? shortAddr(backend.address) : '…'}) for relay gas.
          </p>
          {!info?.canFundSigner && info != null && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 mb-3">
              Add <code className="font-mono">DEPLOYER_ADMIN_PRIVATE_KEY</code> to <code className="font-mono">server/.env</code> to
              enable one-click top-ups from the admin console.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Amount (ETH)</label>
              <input
                type="text"
                inputMode="decimal"
                value={fundAmount}
                onChange={e => { setFundAmount(e.target.value.replace(/[^\d.]/g, '')); setFundMsg(null); }}
                className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums"
                disabled={fundBusy}
              />
            </div>
            <div className="flex gap-1">
              {QUICK_AMOUNTS.map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setFundAmount(a)}
                  className="text-xs px-2 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 tabular-nums"
                >
                  {a}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={fundBusy || !info?.canFundSigner}
              onClick={fundSigner}
            >
              {fundBusy ? 'Sending…' : 'Send ETH'}
            </Button>
          </div>
          {fundMsg && (
            <p className={`mt-3 text-sm ${fundMsg.ok ? 'text-green-700' : 'text-brand-danger'}`}>
              {fundMsg.text}
              {fundMsg.ok && lastTx && (
                <>
                  {' '}
                  <a
                    href={`https://sepolia.etherscan.io/tx/${lastTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    View tx
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pimlico Paymaster</CardTitle>
          <Badge className={isLive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
            {info?.status ?? 'not live'}
          </Badge>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-gray-400 text-xs uppercase">Policy ID</dt><dd className="font-mono">{info?.policy_id ?? '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs uppercase">Balance</dt><dd>{info?.balance_eth ? `${info.balance_eth} ETH` : '—'}</dd></div>
          <div><dt className="text-gray-400 text-xs uppercase">Ops Sponsored</dt><dd>{info?.sponsored_ops ?? '—'}</dd></div>
        </dl>
        {!isLive && (
          <p className="mt-4 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-3">
            Pimlico sponsorship is <strong>not live</strong> — gas is paid by the backend signer (relay).
          </p>
        )}
      </Card>
    </div>
  );
}
