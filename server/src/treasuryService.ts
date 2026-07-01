// src/treasuryService.ts
// On-chain TreasuryToken admin actions performed by the backend signer.
//
// The backend wallet (config.backend.privateKey) holds COMPLIANCE_ROLE on each
// TreasuryToken (granted in Deploy.s.sol), which lets it manage the token's
// trusted-address whitelist. When complianceEnabled is on, a TT transfer is only
// permitted between registered consumers (same country) and whitelisted trusted
// addresses (the platform treasury + merchants). Whitelisting a merchant wallet
// is therefore what lets consumers pay that merchant in the local treasury token.

import { ethers } from 'ethers';
import { config } from './config.js';

const TREASURY_WHITELIST_ABI = [
  'function addToWhitelist(address account)',
  'function removeFromWhitelist(address account)',
  'function whitelisted(address account) view returns (bool)',
];

const VAULT_TRUSTED_ABI = [
  'function setTrustedCounterparty(address account, bool trusted)',
  'function trustedCounterparty(address account) view returns (bool)',
];

const VAULT_HARVEST_ABI = [
  'function harvest(bytes32 currencyCode, address treasuryAddress, uint16 platformFeeBps) returns (uint256 userYield)',
  'function harvestableYield(bytes32 currencyCode) view returns (uint256)',
  'event YieldHarvested(bytes32 indexed currencyCode, uint256 yieldDelta, uint256 platformCut, uint256 userYield, address indexed treasury)',
];

/// Currency code → bytes32, matching the Solidity keccak256("ZAR") / USDC_CODE etc.
function currencyHash(code: string): string {
  return ethers.id(code.toUpperCase());
}

// ── Vault unified-ledger ops (backend = ADMIN_EXECUTOR_ROLE) ───────────────────
// Phase-1 voucher value moves use adminCredit/adminDebit (custodial ledger). The
// value lives on-chain in the Vault; the backend is the custodian moving claims on
// instruction, with KYC/compliance enforced in the service layer.

const VAULT_LEDGER_ABI = [
  'function adminCredit(address user, uint256 amount, bytes32 currencyCode)',
  'function adminDebit(address user, uint256 amount, bytes32 currencyCode)',
  'function unifiedBalance(address user, bytes32 currencyCode) view returns (uint256)',
];

function vaultWriter(): ethers.Contract {
  if (!config.contracts.vault)    throw new Error('No vault address configured');
  if (!config.backend.privateKey) throw new Error('No backend signer configured');
  const signer = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  return new ethers.Contract(config.contracts.vault, VAULT_LEDGER_ABI, signer);
}

export async function vaultBalanceOf(wallet: string, currency: string): Promise<bigint> {
  if (!config.contracts.vault) throw new Error('No vault address configured');
  const v = new ethers.Contract(config.contracts.vault, VAULT_LEDGER_ABI, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  return await v.unifiedBalance(wallet, currencyHash(currency)) as bigint;
}

export async function vaultAdminCredit(wallet: string, amount: bigint, currency: string): Promise<string> {
  const tx = await vaultWriter().adminCredit(wallet, amount, currencyHash(currency));
  const r = await tx.wait() as ethers.TransactionReceipt; return r.hash;
}

// ── POC / dev only: mint TreasuryToken backing ─────────────────────────────────
// The backend holds MINTER_ROLE. Mint is exempt from the compliance/whitelist gate
// (it only applies to peer transfers), so this works regardless of complianceEnabled.
// Used by the dev cash-in tool to simulate a fiat deposit on Sepolia (no real rail).

const TREASURY_MINT_ABI = ['function mint(address to, uint256 amount)'];

export async function mintTreasuryZA(to: string, amount: bigint): Promise<string> {
  if (!config.contracts.treasuryTokenZA) throw new Error('No TTZA address configured');
  if (!config.backend.privateKey)        throw new Error('No backend signer configured');
  const signer = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  const tt = new ethers.Contract(config.contracts.treasuryTokenZA, TREASURY_MINT_ABI, signer);
  const tx = await tt.mint(to, amount);
  const r = await tx.wait() as ethers.TransactionReceipt; return r.hash;
}

export async function vaultAdminDebit(wallet: string, amount: bigint, currency: string): Promise<string> {
  const tx = await vaultWriter().adminDebit(wallet, amount, currencyHash(currency));
  const r = await tx.wait() as ethers.TransactionReceipt; return r.hash;
}

// ── POC / dev only: simulate the platform acquiring USDC reserves ──────────────
// On Sepolia there is no real USDC purchase rail and no Uniswap liquidity, so this
// mints the Vault's configured USDC (a mock token with an open mint) straight into
// the Vault — i.e. grows the platform's USD reserve that backs consumers' USD
// claims. Returns the mint tx + the USDC token address used (vault.usdcToken(), so
// it always matches what the Treasury page reads as "Underlying holdings").
const MOCK_MINT_ABI  = ['function mint(address to, uint256 amount)'];
const VAULT_USDC_ABI = ['function usdcToken() view returns (address)'];

export async function mintUsdcToVault(amount: bigint): Promise<{ mintTx: string; usdc: string }> {
  if (!config.contracts.vault)    throw new Error('No vault address configured');
  if (!config.backend.privateKey) throw new Error('No backend signer configured');
  const signer = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  const vault  = new ethers.Contract(config.contracts.vault, VAULT_USDC_ABI, signer);
  const usdc   = await vault.usdcToken() as string;
  if (!usdc || /^0x0+$/.test(usdc)) throw new Error('Vault has no USDC token configured');
  const token  = new ethers.Contract(usdc, MOCK_MINT_ABI, signer);
  const tx     = await token.mint(config.contracts.vault, amount);
  const r      = await tx.wait() as ethers.TransactionReceipt;
  return { mintTx: r.hash, usdc };
}

// The platform's USD reserve = the USDC the Vault actually holds (backs consumers'
// USD claims). Used to gate ZAR→USD conversions so we never credit more USD claims
// than there is reserve to honour.
const ERC20_BAL_ABI = ['function balanceOf(address) view returns (uint256)'];
export async function usdcReserveUnits(): Promise<bigint> {
  if (!config.contracts.vault) return 0n;
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const vault    = new ethers.Contract(config.contracts.vault, VAULT_USDC_ABI, provider);
  const usdc     = await vault.usdcToken() as string;
  if (!usdc || /^0x0+$/.test(usdc)) return 0n;
  const token = new ethers.Contract(usdc, ERC20_BAL_ABI, provider);
  return await token.balanceOf(config.contracts.vault) as bigint;
}

export interface WhitelistResult {
  whitelisted: boolean;   // true only when the on-chain entry is confirmed set
  txHash?: string;        // present when a transaction was sent
  alreadySet?: boolean;   // true when the address was already set (no-op)
  reason?: string;        // why it was skipped (no token configured, no signer, etc.)
}

/// Combined on-chain registration for a merchant wallet:
///   - treasury: whitelisted on the country's TreasuryToken (receive local TT)
///   - vault:    marked a trusted counterparty on the Vault (receive USDC / unified
///               balances without being a registered consumer)
export interface MerchantOnchainResult {
  treasury: WhitelistResult;
  vault: WhitelistResult;
}

/// Pilot mapping of country → deployed TreasuryToken. Extend as new corridors
/// launch; returns null for countries without a treasury token (skip silently).
function treasuryTokenForCountry(countryCode: string): string {
  switch (countryCode.toUpperCase()) {
    case 'ZA': return config.contracts.treasuryTokenZA;
    case 'ZW': return config.contracts.treasuryTokenZW;
    default:   return '';
  }
}

/// Whitelist a merchant wallet on its country's TreasuryToken so it can receive
/// the local treasury token as settlement. Idempotent: a no-op if already set.
/// Throws on RPC/contract failure — callers decide whether that's fatal.
export async function whitelistMerchant(
  walletAddress: string,
  countryCode: string,
): Promise<WhitelistResult> {
  const tokenAddr = treasuryTokenForCountry(countryCode);
  if (!tokenAddr) {
    return { whitelisted: false, reason: `No treasury token configured for ${countryCode.toUpperCase()}` };
  }
  if (!config.backend.privateKey) {
    return { whitelisted: false, reason: 'No backend signer configured' };
  }

  const signer = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  const token  = new ethers.Contract(tokenAddr, TREASURY_WHITELIST_ABI, signer);

  // Idempotent guard — avoid spending gas re-whitelisting an existing entry.
  if (await token.whitelisted(walletAddress)) {
    return { whitelisted: true, alreadySet: true };
  }

  const tx      = await token.addToWhitelist(walletAddress);
  const receipt = await tx.wait() as ethers.TransactionReceipt | null;
  return { whitelisted: true, txHash: receipt?.hash };
}

/// Mark a merchant wallet as a trusted counterparty on the Vault so consumers can
/// pay it in USDC / unified-ledger balances without it being a registered consumer.
/// Idempotent. Throws on RPC/contract failure — callers decide whether that's fatal.
export async function setVaultTrusted(walletAddress: string): Promise<WhitelistResult> {
  if (!config.contracts.vault) {
    return { whitelisted: false, reason: 'No vault address configured' };
  }
  if (!config.backend.privateKey) {
    return { whitelisted: false, reason: 'No backend signer configured' };
  }

  const signer = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  const vault  = new ethers.Contract(config.contracts.vault, VAULT_TRUSTED_ABI, signer);

  if (await vault.trustedCounterparty(walletAddress)) {
    return { whitelisted: true, alreadySet: true };
  }

  const tx      = await vault.setTrustedCounterparty(walletAddress, true);
  const receipt = await tx.wait() as ethers.TransactionReceipt | null;
  return { whitelisted: true, txHash: receipt?.hash };
}

/// Register a merchant on-chain on both the TreasuryToken (local-currency receipt)
/// and the Vault (USDC / unified-balance receipt). Each leg is independent and
/// best-effort: a failure in one is captured in its result, not thrown, so the
/// caller can surface partial success and retry just the failed leg.
export async function registerMerchantOnchain(
  walletAddress: string,
  countryCode: string,
): Promise<MerchantOnchainResult> {
  const out: MerchantOnchainResult = {
    treasury: { whitelisted: false },
    vault:    { whitelisted: false },
  };

  try {
    out.treasury = await whitelistMerchant(walletAddress, countryCode);
  } catch (e) {
    out.treasury = { whitelisted: false, reason: (e as Error).message };
  }
  try {
    out.vault = await setVaultTrusted(walletAddress);
  } catch (e) {
    out.vault = { whitelisted: false, reason: (e as Error).message };
  }
  return out;
}

// ── Yield harvesting ──────────────────────────────────────────────────────────

export interface HarvestResult {
  txHash: string;
  userYield: string;    // raw token units distributed to holders via price-per-share
  platformCut: string;  // raw token units swept to the treasury
  treasury: string;     // address the platform cut was sent to
  feeBps: number;       // platform fee applied
}

/// Read the currently harvestable yield for a currency (raw token units, as string).
export async function getHarvestableYield(currencyCode: string): Promise<string> {
  if (!config.contracts.vault) throw new Error('No vault address configured');
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const vault    = new ethers.Contract(config.contracts.vault, VAULT_HARVEST_ABI, provider);
  const amt = await vault.harvestableYield(currencyHash(currencyCode)) as bigint;
  return amt.toString();
}

/// Harvest a currency's yield: sweeps the platform fee to the treasury and lifts
/// the price-per-share for holders. Signed by the backend wallet (ADMIN_EXECUTOR_ROLE).
/// treasuryAddress defaults to the platform owner wallet (config.platform.treasuryAddress).
/// Reverts (NoYield) if there is nothing to harvest.
export async function harvestYield(
  currencyCode: string,
  opts?: { treasuryAddress?: string; platformFeeBps?: number },
): Promise<HarvestResult> {
  if (!config.contracts.vault)   throw new Error('No vault address configured');
  if (!config.backend.privateKey) throw new Error('No backend signer configured');

  const treasury = opts?.treasuryAddress || config.platform.treasuryAddress;
  if (!treasury) throw new Error('No platform treasury configured (set PLATFORM_TREASURY_ADDRESS or DEPLOYER_ADMIN_ADDRESS)');
  // Spend-cash currencies are flat 1:1 to consumers → 100% of yield to the protocol,
  // which keeps price-per-share pinned at 1.0 (consumer balances never appreciate).
  const isCash = config.platform.cashCurrencies.includes(currencyCode.toUpperCase());
  const feeBps = isCash ? 10000 : (opts?.platformFeeBps ?? config.platform.harvestFeeBps);

  const signer = new ethers.Wallet(config.backend.privateKey, new ethers.JsonRpcProvider(config.chain.rpcUrl));
  const vault  = new ethers.Contract(config.contracts.vault, VAULT_HARVEST_ABI, signer);

  const tx      = await vault.harvest(currencyHash(currencyCode), treasury, feeBps);
  const receipt = await tx.wait() as ethers.TransactionReceipt;

  // Pull the actual split from the YieldHarvested event.
  const iface = new ethers.Interface(VAULT_HARVEST_ABI);
  let userYield = '0', platformCut = '0';
  for (const log of receipt.logs) {
    try {
      const p = iface.parseLog(log);
      if (p?.name === 'YieldHarvested') {
        userYield   = (p.args.userYield   as bigint).toString();
        platformCut = (p.args.platformCut as bigint).toString();
        break;
      }
    } catch { /* not our event */ }
  }

  return { txHash: receipt.hash, userYield, platformCut, treasury, feeBps };
}
