// src/safeRelayService.ts
// Relays user-signed Safe transactions (Option A: gasless via backend relay).
//
// Self-custody is preserved: the consumer's passkey signs the SafeTx hash for a
// specific Vault.transfer (to / amount / currency / nonce). The backend cannot
// forge or alter that — it can only submit `execTransaction` and pay the gas
// (gasPrice = 0 → no refund). The Safe is msg.sender, so Vault's on-chain KYC
// gate ("each party a KYC'd consumer or a trusted counterparty") is enforced by
// the contract, not the service.
//
// The passkey owner is a SafeWebAuthnSignerSingleton (a contract owner), so the
// signature is wrapped as a Safe contract-signature — see safeWebAuthn.ts.

import { ethers } from 'ethers';
import config from './config.js';
import { recordGasFromReceipt } from './gasCostService.js';
import { encodeWebAuthnSignature, encodeSafeContractSignature, type RawAssertion } from './safeWebAuthn.js';

const SAFE_ABI = [
  'function nonce() view returns (uint256)',
  'function getThreshold() view returns (uint256)',
  'function isOwner(address owner) view returns (bool)',
  'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)',
];

const VAULT_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount, bytes32 currencyCode)',
];

/// Currency code → bytes32, matching Solidity keccak256("ZAR") / USDC_CODE.
export function currencyHash(code: string): string {
  return ethers.id(code.toUpperCase());
}

export interface SafeTx {
  to: string;
  value: string;          // decimal string (wei) — always "0" here
  data: string;           // 0x calldata
  operation: number;      // 0 = CALL
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: string;
}

const EIP712_SAFE_TX_TYPE = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
};

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

function backendWallet(): ethers.Wallet {
  if (!config.backend.privateKey) throw new Error('No backend signer configured');
  return new ethers.Wallet(config.backend.privateKey, provider());
}

/// Build the SafeTx that wraps a Vault.transfer, and compute its EIP-712 hash.
/// The off-chain hash is cross-checked against the Safe's own getTransactionHash
/// so a wrong domain/typehash can never reach the user as a challenge.
export async function buildVaultTransferSafeTx(params: {
  safeAddress: string;
  toAddress: string;
  amount: bigint;
  currency: string;
}): Promise<{ safeTx: SafeTx; safeTxHash: string }> {
  if (!config.contracts.vault) throw new Error('No vault address configured');
  const p = provider();

  const code = await p.getCode(params.safeAddress);
  if (code === '0x') throw new Error('Sender Safe is not deployed on-chain');

  const safe = new ethers.Contract(params.safeAddress, SAFE_ABI, p);
  const nonce: bigint = await safe.nonce();

  const data = new ethers.Interface(VAULT_TRANSFER_ABI).encodeFunctionData('transfer', [
    params.toAddress, params.amount, currencyHash(params.currency),
  ]);

  const safeTx: SafeTx = {
    to: config.contracts.vault,
    value: '0',
    data,
    operation: 0,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: ethers.ZeroAddress,
    refundReceiver: ethers.ZeroAddress,
    nonce: nonce.toString(),
  };

  const offChainHash = ethers.TypedDataEncoder.hash(
    { chainId: config.chain.chainId, verifyingContract: params.safeAddress },
    EIP712_SAFE_TX_TYPE,
    safeTx,
  );

  // Authoritative cross-check against the deployed Safe.
  const onChainHash: string = await safe.getTransactionHash(
    safeTx.to, safeTx.value, safeTx.data, safeTx.operation, safeTx.safeTxGas,
    safeTx.baseGas, safeTx.gasPrice, safeTx.gasToken, safeTx.refundReceiver, safeTx.nonce,
  );
  if (offChainHash.toLowerCase() !== onChainHash.toLowerCase()) {
    throw new Error(`SafeTx hash mismatch (off-chain ${offChainHash} vs on-chain ${onChainHash})`);
  }

  return { safeTx, safeTxHash: onChainHash };
}

/// Relay a passkey-signed SafeTx via execTransaction. Backend pays gas.
/// `ownerSignerAddress` is the consumer's SafeWebAuthnSignerSingleton (the Safe's
/// sole owner). Returns the relay transaction hash.
export async function relaySafeTx(params: {
  safeAddress: string;
  ownerSignerAddress: string;
  safeTx: SafeTx;
  assertion: RawAssertion;
}): Promise<string> {
  const wallet = backendWallet();
  const safe = new ethers.Contract(params.safeAddress, SAFE_ABI, wallet);

  const innerSig = encodeWebAuthnSignature(params.assertion);
  const signatures = encodeSafeContractSignature(params.ownerSignerAddress, innerSig);

  const t = params.safeTx;
  const tx = await safe.execTransaction(
    t.to, t.value, t.data, t.operation, t.safeTxGas,
    t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, signatures,
  );
  const receipt = await tx.wait() as ethers.TransactionReceipt;
  await recordGasFromReceipt(receipt, 'relay');
  return receipt.hash;
}

/// Read a consumer's spendable unified-ledger balance (asset units).
export async function unifiedBalanceOf(wallet: string, currency: string): Promise<bigint> {
  if (!config.contracts.vault) throw new Error('No vault address configured');
  const v = new ethers.Contract(
    config.contracts.vault,
    ['function unifiedBalance(address user, bytes32 currencyCode) view returns (uint256)'],
    provider(),
  );
  return await v.unifiedBalance(wallet, currencyHash(currency)) as bigint;
}

/// Read an on-chain KYC level from the Consumer contract (0 if unregistered).
export async function kycLevelOf(wallet: string): Promise<number> {
  if (!config.contracts.consumer) return 0;
  const c = new ethers.Contract(
    config.contracts.consumer,
    ['function getKycLevel(address wallet) view returns (uint8)'],
    provider(),
  );
  try { return Number(await c.getKycLevel(wallet)); } catch { return 0; }
}

/// Read whether an address is a registered consumer (any KYC level, Level 0+).
/// Mirrors the Vault transfer gate (v1.2.0): registration, not KYC level, is what
/// admits a party — getKycLevel returns 0 for both Level-0 and unregistered wallets,
/// so this is the only way to tell them apart.
export async function isRegisteredConsumer(wallet: string): Promise<boolean> {
  if (!config.contracts.consumer) return false;
  const c = new ethers.Contract(
    config.contracts.consumer,
    ['function isRegistered(address wallet) view returns (bool)'],
    provider(),
  );
  try { return await c.isRegistered(wallet) as boolean; } catch { return false; }
}

/// Read whether an address is a Vault trusted counterparty (merchant / treasury / escrow).
export async function isTrustedCounterparty(wallet: string): Promise<boolean> {
  if (!config.contracts.vault) return false;
  const v = new ethers.Contract(
    config.contracts.vault,
    ['function trustedCounterparty(address account) view returns (bool)'],
    provider(),
  );
  try { return await v.trustedCounterparty(wallet) as boolean; } catch { return false; }
}
