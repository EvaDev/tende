// Resolve known wallet addresses to human-readable labels for admin reports.

import db from './db.js';
import config from './config.js';

export async function buildAddressLabelMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const add = (addr: string | null | undefined, label: string) => {
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
    map.set(addr.toLowerCase(), label);
  };

  add(config.contracts.vault, 'Vault');
  add(config.platform.treasuryAddress, 'Platform treasury');
  add(process.env.DEPLOYER_ADMIN_ADDRESS, 'Platform owner');
  add(process.env.BACKEND_SIGNER_ADDRESS, 'Backend signer');

  const [consumers, merchants] = await Promise.all([
    db.query<{ wallet_address: string; ens_subdomain: string | null }>(
      `SELECT wallet_address, ens_subdomain FROM consumers WHERE wallet_address IS NOT NULL`,
    ).catch(() => ({ rows: [] as { wallet_address: string; ens_subdomain: string | null }[] })),
    db.query<{ wallet_address: string; name: string }>(
      `SELECT wallet_address, name FROM merchants WHERE wallet_address IS NOT NULL`,
    ).catch(() => ({ rows: [] as { wallet_address: string; name: string }[] })),
  ]);

  for (const c of consumers.rows) {
    const label = c.ens_subdomain ? `@${c.ens_subdomain}` : `Consumer ${c.wallet_address.slice(0, 6)}…`;
    add(c.wallet_address, label);
  }
  for (const m of merchants.rows) {
    add(m.wallet_address, m.name || `Merchant ${m.wallet_address.slice(0, 6)}…`);
  }

  return map;
}

export function labelForAddress(map: Map<string, string>, address: string): string {
  const a = (address ?? '').toLowerCase();
  if (!a) return '—';
  return map.get(a) ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}
