import { ethers } from 'ethers';
import config from './config.js';

/** Resolve a 0x address or @payment-tag to a consumer spend wallet. */
export async function resolveWalletOrTag(input: string): Promise<string> {
  const v = (input || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return ethers.getAddress(v);
  const tag = v.replace(/^@/, '').toLowerCase().split('.')[0];
  if (!/^[a-z0-9-]{3,32}$/.test(tag)) throw new Error('Enter a 0x address or @tag');
  if (!config.contracts.consumer) throw new Error('Consumer contract not configured');
  const consumer = new ethers.Contract(
    config.contracts.consumer,
    ['function getConsumerByEns(bytes32 ensHash) view returns (tuple(address spendWallet,address saveWallet,address usdWallet,bytes32 displayNameHash,bytes32 ensSubdomainHash,bytes32 countryCode,uint8 kycLevel,bool isActive,uint256 globalConsumerId))'],
    new ethers.JsonRpcProvider(config.chain.rpcUrl),
  );
  try {
    const d = await consumer.getConsumerByEns(ethers.keccak256(ethers.toUtf8Bytes(tag)));
    if (!d.isActive) throw new Error('Inactive account');
    return d.spendWallet as string;
  } catch (e) {
    if ((e as Error).message === 'Inactive account') throw e;
    throw new Error(`No account found for @${tag}`);
  }
}
