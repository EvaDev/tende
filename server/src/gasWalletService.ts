// Platform gas wallet helpers — balances and deployer → signer ETH top-ups.

import { ethers } from 'ethers';
import config from './config.js';
import { backendSignerAddress, deployerAdminAddress } from './gasCostService.js';

export interface GasWalletInfo {
  envKey: string;
  label: string;
  purpose: string;
  address: string | null;
  balanceEth: string | null;
}

export function resolveBackendSignerAddress(): string {
  const fromEnv = process.env['BACKEND_SIGNER_ADDRESS'] ?? '';
  if (/^0x[0-9a-fA-F]{40}$/.test(fromEnv)) return ethers.getAddress(fromEnv);
  try { return backendSignerAddress(); } catch { return ''; }
}

export async function ethBalanceOf(address: string): Promise<string | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  try {
    const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
    const wei = await provider.getBalance(address);
    return ethers.formatEther(wei);
  } catch {
    return null;
  }
}

export async function getGasWallets(): Promise<GasWalletInfo[]> {
  const deployer = deployerAdminAddress();
  const backend = resolveBackendSignerAddress();
  const [deployerBal, backendBal] = await Promise.all([
    deployer ? ethBalanceOf(deployer) : Promise.resolve(null),
    backend ? ethBalanceOf(backend) : Promise.resolve(null),
  ]);
  return [
    {
      envKey: 'DEPLOYER_ADMIN_ADDRESS',
      label: 'Deployer / owner',
      purpose: 'Contract deployments & upgrades',
      address: deployer || null,
      balanceEth: deployerBal,
    },
    {
      envKey: 'BACKEND_SIGNER_ADDRESS',
      label: 'Backend signer',
      purpose: 'Relay, mint, settle & other day-to-day gas',
      address: backend || null,
      balanceEth: backendBal,
    },
  ];
}

export function deployerPrivateKeyConfigured(): boolean {
  const key = process.env['DEPLOYER_ADMIN_PRIVATE_KEY'] ?? '';
  return /^0x[0-9a-fA-F]{64}$/.test(key);
}

/** Send native ETH from deployer admin to backend signer (gas top-up). */
export async function sendEthFromDeployerToSigner(amountEth: string): Promise<{
  txHash: string;
  from: string;
  to: string;
  amountEth: string;
}> {
  const deployerKey = process.env['DEPLOYER_ADMIN_PRIVATE_KEY'] ?? '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
    throw Object.assign(
      new Error('DEPLOYER_ADMIN_PRIVATE_KEY is not configured on the server — add it to server/.env to enable gas top-ups'),
      { status: 503, code: 'DEPLOYER_KEY_MISSING' },
    );
  }

  const from = deployerAdminAddress();
  const to = resolveBackendSignerAddress();
  if (!from) throw Object.assign(new Error('DEPLOYER_ADMIN_ADDRESS is not configured'), { status: 503 });
  if (!to) throw Object.assign(new Error('BACKEND_SIGNER_ADDRESS is not configured'), { status: 503 });

  let amountWei: bigint;
  try {
    amountWei = ethers.parseEther(String(amountEth).trim());
  } catch {
    throw Object.assign(new Error('Invalid amount'), { status: 400 });
  }
  if (amountWei <= 0n) throw Object.assign(new Error('Amount must be positive'), { status: 400 });

  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const wallet = new ethers.Wallet(deployerKey, provider);
  if (wallet.address.toLowerCase() !== from.toLowerCase()) {
    throw Object.assign(
      new Error('DEPLOYER_ADMIN_PRIVATE_KEY does not match DEPLOYER_ADMIN_ADDRESS'),
      { status: 503, code: 'DEPLOYER_KEY_MISMATCH' },
    );
  }

  const balance = await provider.getBalance(from);
  const gasReserve = ethers.parseEther('0.002');
  if (balance < amountWei + gasReserve) {
    throw Object.assign(
      new Error(`Insufficient deployer balance — need ${ethers.formatEther(amountWei + gasReserve)} ETH including gas reserve`),
      { status: 409, code: 'INSUFFICIENT_BALANCE' },
    );
  }

  const tx = await wallet.sendTransaction({ to, value: amountWei });
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Transaction dropped');

  return {
    txHash: receipt.hash,
    from,
    to,
    amountEth: ethers.formatEther(amountWei),
  };
}
