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
  /** Gas report source tag (default: passkey payment). */
  gasSource?: string;
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
  await recordGasFromReceipt(receipt, params.gasSource ?? 'passkey');
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

// ── SessionTransferModule (cheaper per-tx auth) ───────────────────────────────

const SESSION_MODULE_ABI = [
  'function addSessionKey(address sessionKey, uint64 expiry, uint256 maxPerTx, uint256 dailyCap)',
  'function removeSessionKey(address sessionKey)',
  'function executeTransfer(address safe, address sessionKey, address to, uint256 amount, bytes32 currencyCode, uint256 deadline, bytes signature) returns (bool)',
  'function sessionTransferHash(address safe, address sessionKey, address to, uint256 amount, bytes32 currencyCode, uint256 deadline) view returns (bytes32)',
  'function getSession(address safe, address sessionKey) view returns (tuple(uint64 expiry, uint256 maxPerTx, uint256 dailyCap, uint256 dailySpent, uint256 dayBucket, uint256 nonce, bool active))',
  'function domainSeparator() view returns (bytes32)',
];

export function sessionTransferModuleConfigured(): boolean {
  return !!config.contracts.sessionTransferModule;
}

const SAFE_MODULE_MANAGER_ABI = [
  'function isModuleEnabled(address module) view returns (bool)',
  'function enableModule(address module)',
];

export async function isSessionModuleEnabledOnSafe(safeAddress: string): Promise<boolean> {
  if (!config.contracts.sessionTransferModule) return false;
  const safe = new ethers.Contract(safeAddress, SAFE_MODULE_MANAGER_ABI, provider());
  try {
    return await safe.isModuleEnabled(config.contracts.sessionTransferModule) as boolean;
  } catch {
    return false;
  }
}

export async function buildEnableSessionModuleSafeTx(params: {
  safeAddress: string;
}): Promise<{ safeTx: SafeTx; safeTxHash: string }> {
  if (!config.contracts.sessionTransferModule) throw new Error('No session transfer module configured');
  const iface = new ethers.Interface(SAFE_MODULE_MANAGER_ABI);
  const data = iface.encodeFunctionData('enableModule', [config.contracts.sessionTransferModule]);
  return buildModuleSafeTx({ safeAddress: params.safeAddress, moduleCalldata: data, to: params.safeAddress });
}

async function buildModuleSafeTx(params: {
  safeAddress: string;
  moduleCalldata: string;
  to?: string;
}): Promise<{ safeTx: SafeTx; safeTxHash: string }> {
  const p = provider();
  const safe = new ethers.Contract(params.safeAddress, SAFE_ABI, p);
  const nonce: bigint = await safe.nonce();

  const safeTx: SafeTx = {
    to: params.to ?? config.contracts.sessionTransferModule!,
    value: '0',
    data: params.moduleCalldata,
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
  const onChainHash: string = await safe.getTransactionHash(
    safeTx.to, safeTx.value, safeTx.data, safeTx.operation, safeTx.safeTxGas,
    safeTx.baseGas, safeTx.gasPrice, safeTx.gasToken, safeTx.refundReceiver, safeTx.nonce,
  );
  if (offChainHash.toLowerCase() !== onChainHash.toLowerCase()) {
    throw new Error(`SafeTx hash mismatch (off-chain ${offChainHash} vs on-chain ${onChainHash})`);
  }
  return { safeTx, safeTxHash: onChainHash };
}

export async function buildAddSessionKeySafeTx(params: {
  safeAddress: string;
  sessionKeyAddress: string;
  expiry: bigint;
  maxPerTx: bigint;
  dailyCap: bigint;
}): Promise<{ safeTx: SafeTx; safeTxHash: string }> {
  const iface = new ethers.Interface(SESSION_MODULE_ABI);
  const data = iface.encodeFunctionData('addSessionKey', [
    params.sessionKeyAddress, params.expiry, params.maxPerTx, params.dailyCap,
  ]);
  return buildModuleSafeTx({ safeAddress: params.safeAddress, moduleCalldata: data });
}

export async function buildRemoveSessionKeySafeTx(params: {
  safeAddress: string;
  sessionKeyAddress: string;
}): Promise<{ safeTx: SafeTx; safeTxHash: string }> {
  const iface = new ethers.Interface(SESSION_MODULE_ABI);
  const data = iface.encodeFunctionData('removeSessionKey', [params.sessionKeyAddress]);
  return buildModuleSafeTx({ safeAddress: params.safeAddress, moduleCalldata: data });
}

export async function getSessionNonce(safeAddress: string, sessionKeyAddress: string): Promise<bigint> {
  if (!config.contracts.sessionTransferModule) throw new Error('No session transfer module configured');
  const mod = new ethers.Contract(config.contracts.sessionTransferModule, SESSION_MODULE_ABI, provider());
  const sess = await mod.getSession(safeAddress, sessionKeyAddress) as { nonce: bigint };
  return sess.nonce;
}

export interface OnChainSession {
  expiry: bigint;
  maxPerTx: bigint;
  dailyCap: bigint;
  dailySpent: bigint;
  dayBucket: bigint;
  nonce: bigint;
  active: boolean;
}

export async function getOnChainSession(safeAddress: string, sessionKeyAddress: string): Promise<OnChainSession> {
  if (!config.contracts.sessionTransferModule) throw new Error('No session transfer module configured');
  const mod = new ethers.Contract(config.contracts.sessionTransferModule, SESSION_MODULE_ABI, provider());
  const sess = await mod.getSession(safeAddress, sessionKeyAddress) as OnChainSession;
  return sess;
}

export async function sessionTransferDigest(params: {
  safeAddress: string;
  sessionKeyAddress: string;
  toAddress: string;
  amount: bigint;
  currency: string;
  deadline: bigint;
}): Promise<string> {
  if (!config.contracts.sessionTransferModule) throw new Error('No session transfer module configured');
  const mod = new ethers.Contract(config.contracts.sessionTransferModule, SESSION_MODULE_ABI, provider());
  const hash: string = await mod.sessionTransferHash(
    params.safeAddress,
    params.sessionKeyAddress,
    params.toAddress,
    params.amount,
    currencyHash(params.currency),
    params.deadline,
  );
  return hash;
}

export async function relaySessionTransfer(params: {
  walletAddress: string;
  sessionAddress: string;
  toAddress: string;
  amount: bigint;
  currency: string;
  deadline: bigint;
  signature: string;
}): Promise<string> {
  if (!config.contracts.sessionTransferModule) throw new Error('No session transfer module configured');
  const wallet = backendWallet();
  const mod = new ethers.Contract(config.contracts.sessionTransferModule, SESSION_MODULE_ABI, wallet);
  const tx = await mod.executeTransfer(
    params.walletAddress,
    params.sessionAddress,
    params.toAddress,
    params.amount,
    currencyHash(params.currency),
    params.deadline,
    params.signature,
  );
  const receipt = await tx.wait() as ethers.TransactionReceipt;
  await recordGasFromReceipt(receipt, 'session');
  return receipt.hash;
}
