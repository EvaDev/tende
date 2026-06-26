// scripts/prove-4337-registration.ts
// End-to-end proof that the upgraded Consumer (v1.1.0) deploys 4337-capable Safes.
// Registers a throwaway consumer through the LIVE Consumer proxy and checks the
// resulting Safe has Safe4337Module enabled. Costs gas (createSigner + register).
//
//   run: cd server && DEPLOYER_ADMIN_PRIVATE_KEY=0x… npx tsx scripts/prove-4337-registration.ts

import crypto from 'crypto';
import { ethers } from 'ethers';
import config from '../src/config.js';

const FACTORY_ABI = [
  'function createSigner(uint256 x, uint256 y, uint176 verifiers) returns (address signer)',
  'function getSigner(uint256 x, uint256 y, uint176 verifiers) view returns (address signer)',
];
const CONSUMER_ABI = [
  'function VERSION() view returns (string)',
  'function safe4337Module() view returns (address)',
  'function registerConsumer(bytes32 ensHash, bytes32 nameHash, bytes32 countryCode, uint8 kycLevel, address initialOwner) returns (address wallet)',
  'event ConsumerRegistered(address indexed wallet, uint256 indexed globalId, bytes32 countryCode, uint8 kycLevel)',
];
const SAFE_ABI = ['function isModuleEnabled(address module) view returns (bool)'];

async function main() {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const ownerKey = process.env.DEPLOYER_ADMIN_PRIVATE_KEY;
  if (!ownerKey) throw new Error('Set DEPLOYER_ADMIN_PRIVATE_KEY (owner holds REGISTRAR_ROLE)');
  const owner = new ethers.Wallet(ownerKey, provider);

  const consumer = new ethers.Contract(config.contracts.consumer, CONSUMER_ABI, owner);
  const version = await consumer.VERSION();
  const module: string = await consumer.safe4337Module();
  console.log('Consumer VERSION:', version, '| safe4337Module:', module);

  // Throwaway passkey signer
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = BigInt('0x' + Buffer.from(jwk.x, 'base64url').toString('hex'));
  const y = BigInt('0x' + Buffer.from(jwk.y, 'base64url').toString('hex'));
  const verifiers = config.safe.webAuthnVerifiers;

  const factory = new ethers.Contract(config.safe.webAuthnSignerFactory, FACTORY_ABI, owner);
  const signerAddr: string = await factory.getSigner(x, y, verifiers);
  if ((await provider.getCode(signerAddr)) === '0x') await (await factory.createSigner(x, y, verifiers)).wait();
  console.log('signer:', signerAddr);

  // Register through the live Consumer (deploys the Safe via _deployConsumerWallet)
  const tag = 'test4337-' + crypto.randomBytes(4).toString('hex');
  const tx = await consumer.registerConsumer(
    ethers.keccak256(ethers.toUtf8Bytes(tag)),
    ethers.keccak256(ethers.toUtf8Bytes('Test 4337')),
    ethers.keccak256(ethers.toUtf8Bytes('ZA')),
    0, signerAddr,
  );
  const receipt = await tx.wait() as ethers.TransactionReceipt;
  const iface = new ethers.Interface(CONSUMER_ABI);
  let wallet = '';
  for (const log of receipt.logs) {
    try { const p = iface.parseLog(log); if (p?.name === 'ConsumerRegistered') { wallet = p.args.wallet as string; break; } } catch { /* skip */ }
  }
  console.log('deployed Safe:', wallet, '(tag', tag + ')');

  const safe = new ethers.Contract(wallet, SAFE_ABI, provider);
  const enabled: boolean = await safe.isModuleEnabled(module);
  console.log('isModuleEnabled(Safe4337Module):', enabled);
  console.log(enabled ? '✅ PROVEN: live Consumer deploys 4337-capable Safes' : '❌ FAILED');
  process.exit(enabled ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e.shortMessage ?? e.message ?? e); process.exit(1); });
