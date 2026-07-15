// lib/wallet.ts
// Lightweight MetaMask / injected-wallet helpers for merchant *owner registration
// only. Day-to-day operator login stays passkey-only (no wagmi in this app).

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  selectedAddress?: string | null;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function getEth(): EthProvider | undefined {
  return (window as Window & { ethereum?: EthProvider }).ethereum;
}

function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number; message?: string };
  return err?.code === 4001 || /reject|denied|cancel/i.test(err?.message ?? '');
}

export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && Boolean(getEth());
}

/**
 * Connect / read the active injected account.
 *
 * MetaMask remembers which accounts this origin already authorized. A plain
 * eth_requestAccounts call will keep returning that set (e.g. …aa71) even when
 * a different account is selected in the extension UI. To actually switch,
 * we revoke site permissions first so the next connect prompt is a clean pick.
 */
export async function connectWallet(opts: { forceAccountPicker?: boolean } = {}): Promise<string> {
  const eth = getEth();
  if (!eth) throw new Error('No wallet found. Install MetaMask (or another injected wallet) to register.');

  if (opts.forceAccountPicker) {
    try {
      await eth.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch (e) {
      if (isUserRejection(e)) throw new Error('Wallet connection cancelled');
      // Older wallets may not support revoke — fall through and try a fresh request.
    }
  }

  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[];
    const addr = accounts?.[0]?.toLowerCase() ?? null;
    if (!addr) throw new Error('No account returned from wallet');
    return addr;
  } catch (e) {
    if (isUserRejection(e)) throw new Error('Wallet connection cancelled');
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Keep the UI in sync when the user switches account in MetaMask. */
export function onWalletAccountsChanged(handler: (address: string | null) => void): () => void {
  const eth = getEth();
  if (!eth?.on) return () => {};
  const listener = (accounts: unknown) => {
    const list = Array.isArray(accounts) ? accounts as string[] : [];
    handler(list[0]?.toLowerCase() ?? null);
  };
  eth.on('accountsChanged', listener);
  return () => { eth.removeListener?.('accountsChanged', listener); };
}

export async function signMessage(address: string, message: string): Promise<string> {
  const eth = getEth();
  if (!eth) throw new Error('No wallet found');
  const sig = await eth.request({
    method: 'personal_sign',
    params: [message, address],
  }) as string;
  return sig;
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
