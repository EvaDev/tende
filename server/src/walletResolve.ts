import { ethers } from 'ethers';
import config from './config.js';
import db from './db.js';

const CONSUMER_VIEW_ABI = [
  'function getConsumer(address wallet) view returns (tuple(address spendWallet,address saveWallet,address usdWallet,bytes32 displayNameHash,bytes32 ensSubdomainHash,bytes32 countryCode,uint8 kycLevel,bool isActive,uint256 globalConsumerId))',
  'function getConsumerByEns(bytes32 ensHash) view returns (tuple(address spendWallet,address saveWallet,address usdWallet,bytes32 displayNameHash,bytes32 ensSubdomainHash,bytes32 countryCode,uint8 kycLevel,bool isActive,uint256 globalConsumerId))',
  'function getConsumerByGlobalId(uint256 globalId) view returns (tuple(address spendWallet,address saveWallet,address usdWallet,bytes32 displayNameHash,bytes32 ensSubdomainHash,bytes32 countryCode,uint8 kycLevel,bool isActive,uint256 globalConsumerId))',
];

function consumerContract(): ethers.Contract {
  if (!config.contracts.consumer) throw new Error('Consumer contract not configured');
  return new ethers.Contract(
    config.contracts.consumer,
    CONSUMER_VIEW_ABI,
    new ethers.JsonRpcProvider(config.chain.rpcUrl),
  );
}

/** Pure digits 4–18 → treat as on-chain account number (globalConsumerId). */
function looksLikeAccountNumber(v: string): boolean {
  return /^\d{4,18}$/.test(v.trim());
}

/**
 * Resolve a destination to a consumer spend wallet.
 * Accepts: 0x address | @payment-tag | account number (globalConsumerId).
 */
export async function resolveWalletOrTag(input: string): Promise<string> {
  const v = (input || '').trim();
  if (!v) throw new Error('Enter a destination');

  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return ethers.getAddress(v);

  // Account number before tag — bare digits must not be treated as ENS.
  if (looksLikeAccountNumber(v)) {
    return resolveAccountNumber(v);
  }

  const tag = v.replace(/^@/, '').toLowerCase().split('.')[0];
  if (!/^[a-z0-9-]{3,32}$/.test(tag)) {
    throw new Error('Enter a payment tag (@tag), account number, or 0x address');
  }

  const consumer = consumerContract();
  try {
    const d = await consumer.getConsumerByEns(ethers.keccak256(ethers.toUtf8Bytes(tag)));
    if (!d.isActive) throw new Error('Inactive account');
    return d.spendWallet as string;
  } catch (e) {
    if ((e as Error).message === 'Inactive account') throw e;
    throw new Error(`No account found for @${tag}`);
  }
}

async function resolveAccountNumber(raw: string): Promise<string> {
  const id = BigInt(raw.trim());

  // Prefer DB when backfilled / registered through this stack.
  const pg = await db.query<{ wallet_address: string }>(
    `SELECT wallet_address FROM consumers
     WHERE global_consumer_id = $1 AND wallet_address IS NOT NULL AND is_active = true
     LIMIT 1`,
    [id.toString()],
  );
  if (pg.rows[0]?.wallet_address) {
    return ethers.getAddress(pg.rows[0].wallet_address);
  }

  const consumer = consumerContract();
  try {
    const d = await consumer.getConsumerByGlobalId(id);
    if (!d.isActive) throw new Error('Inactive account');
    return d.spendWallet as string;
  } catch (e) {
    if ((e as Error).message === 'Inactive account') throw e;
    throw new Error(`No account found for account number ${raw.trim()}`);
  }
}
