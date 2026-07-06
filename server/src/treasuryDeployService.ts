// Deploy TreasuryToken corridor *instances*: shared implementation + ERC-1967 proxy
// + initialize(name, symbol, admin, supply). Same pattern as script/Deploy.s.sol.
// Instances are registered in stablecoins — not in contract_deployments.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import db from './db.js';
import config from './config.js';
import { deployerAdminAddress, recordGasFromReceipt } from './gasCostService.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ERC1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

function loadArtifact(solFile: string, contract: string): { abi: ethers.InterfaceAbi; bytecode: string } {
  const path = join(REPO_ROOT, 'out', `${solFile}.sol`, `${contract}.json`);
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: ethers.InterfaceAbi; bytecode: { object: string } };
  if (!json.bytecode?.object) throw new Error(`Missing bytecode in ${path} — run forge build`);
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function currencyHash(code: string): string {
  return ethers.id(code.toUpperCase());
}

function deployerPrivateKey(): string {
  const raw = (process.env['DEPLOYER_ADMIN_PRIVATE_KEY'] ?? '').trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return `0x${raw}`;
  return '';
}

function deployerWallet(): ethers.Wallet {
  const key = deployerPrivateKey();
  if (!key) throw new Error('DEPLOYER_ADMIN_PRIVATE_KEY is not configured — treasury deployment requires the deployer wallet');
  return new ethers.Wallet(key, new ethers.JsonRpcProvider(config.chain.rpcUrl));
}

const TT_INIT_ABI = [
  'function initialize(string name_, string symbol_, address admin, uint256 initialSupply)',
  'function upgradeToAndCall(address newImplementation, bytes data)',
  'function VERSION() view returns (string)',
];
const TT_ROLES_ABI = [
  'function MINTER_ROLE() view returns (bytes32)',
  'function COMPLIANCE_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account)',
  'function setConsumerContract(address consumer)',
  'function setComplianceEnabled(bool enabled)',
  'function addToWhitelist(address account)',
];
const VAULT_WIRE_ABI = [
  'function setCurrencyTreasuryToken(bytes32 currencyCode, address treasuryToken)',
];

export interface DeployTreasuryResult {
  currencyCode: string;
  fiatCode: string;
  proxyAddress: string;
  implementationAddress: string;
  deployTx: string;
  wired: boolean;
}

export interface TreasuryInstanceRow {
  symbol: string;
  name: string;
  fiat_code: string;
  proxy_address: string;
  is_deployed: boolean;
}

async function recordDeployGas(receipt: ethers.TransactionReceipt, source: string) {
  await recordGasFromReceipt(receipt, source, 'deployment', { expectedPayer: deployerAdminAddress() });
}

async function readProxyImplementation(provider: ethers.Provider, proxy: string): Promise<string> {
  const slot = await provider.getStorage(proxy, ERC1967_IMPL_SLOT);
  const addr = ethers.getAddress(ethers.dataSlice(slot, 12));
  return addr === ethers.ZeroAddress ? '' : addr;
}

/** Shared TreasuryToken implementation — one logic contract for all corridor instances. */
export async function getSharedTreasuryImplementation(): Promise<string> {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);

  const fromDb = await db.query<{ impl_address: string }>(
    `SELECT impl_address FROM contract_deployments WHERE contract_name = 'TreasuryToken' LIMIT 1`,
  );
  if (fromDb.rows[0]?.impl_address && /^0x[0-9a-fA-F]{40}$/.test(fromDb.rows[0].impl_address)) {
    return ethers.getAddress(fromDb.rows[0].impl_address);
  }

  // Legacy fallback: read impl slot from TTZA proxy (env or stablecoins).
  const ttza = config.contracts.treasuryTokenZA
    || (await db.query<{ contract_address: string }>(
      `SELECT contract_address FROM stablecoins WHERE internal_code = 'TTZA' LIMIT 1`,
    )).rows[0]?.contract_address;
  if (ttza) {
    const live = await readProxyImplementation(provider, ttza);
    if (live) return live;
  }
  throw new Error('No shared TreasuryToken implementation found — run migration 030 or deploy TTZA first');
}

/** Deploy a new proxy instance against the shared implementation (no new logic contract). */
async function deployTreasuryProxyInstance(
  wallet: ethers.Wallet,
  name: string,
  symbol: string,
  admin: string,
  initialSupply: bigint,
): Promise<{ proxy: string; txHash: string }> {
  const impl = await getSharedTreasuryImplementation();
  const initData = new ethers.Interface(TT_INIT_ABI).encodeFunctionData('initialize', [
    name, symbol, admin, initialSupply,
  ]);
  const proxyArtifact = loadArtifact('ERC1967Proxy', 'ERC1967Proxy');
  const proxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, wallet);
  const proxyContract = await proxyFactory.deploy(impl, initData);
  const rcpt = await proxyContract.deploymentTransaction()?.wait();
  if (!rcpt?.hash) throw new Error('Proxy deployment failed');
  await recordDeployGas(rcpt, `contract_deploy:TreasuryToken:${symbol}:instance`);
  return { proxy: await proxyContract.getAddress(), txHash: rcpt.hash };
}

/** Point a proxy at the shared implementation if it was deployed with its own logic copy. */
export async function alignInstanceToSharedImplementation(proxyAddress: string): Promise<void> {
  const wallet = deployerWallet();
  const shared = await getSharedTreasuryImplementation();
  const current = await readProxyImplementation(wallet.provider!, proxyAddress);
  if (!current || current.toLowerCase() === shared.toLowerCase()) return;

  const tt = new ethers.Contract(proxyAddress, TT_INIT_ABI, wallet);
  const tx = await tt.upgradeToAndCall(shared, '0x');
  const rcpt = await tx.wait();
  if (rcpt) await recordDeployGas(rcpt, 'contract_upgrade:TreasuryToken:align');
}

export async function listTreasuryInstances(): Promise<TreasuryInstanceRow[]> {
  const r = await db.query<TreasuryInstanceRow>(
    `SELECT s.internal_code AS symbol, c.name, c.base_currency_code AS fiat_code,
            s.contract_address AS proxy_address, s.is_deployed
       FROM stablecoins s
       JOIN currencies c ON c.currency_code = s.internal_code
      WHERE s.is_treasury_token = TRUE
      ORDER BY s.internal_code`,
  );
  return r.rows;
}

export async function treasuryTokenAddressForCountry(countryCode: string): Promise<string> {
  const r = await db.query<{ address: string }>(
    `SELECT s.contract_address AS address
       FROM stablecoins s
       JOIN currencies c ON c.currency_code = s.internal_code
       JOIN countries co ON co.currency_code = c.base_currency_code
      WHERE co.country_code = $1
        AND s.is_treasury_token = TRUE
        AND s.is_deployed = TRUE
        AND s.contract_address IS NOT NULL
      LIMIT 1`,
    [countryCode.toUpperCase()],
  );
  return r.rows[0]?.address ?? '';
}

export async function treasuryTokenAddressForFiat(fiatCode: string): Promise<string> {
  const r = await db.query<{ address: string }>(
    `SELECT s.contract_address AS address
       FROM stablecoins s
       JOIN currencies c ON c.currency_code = s.internal_code
      WHERE c.base_currency_code = $1
        AND s.is_treasury_token = TRUE
        AND s.is_deployed = TRUE
        AND s.contract_address IS NOT NULL
      LIMIT 1`,
    [fiatCode.toUpperCase()],
  );
  if (r.rows[0]?.address) return r.rows[0].address;
  switch (fiatCode.toUpperCase()) {
    case 'ZAR': return config.contracts.treasuryTokenZA;
    case 'ZWL':
    case 'ZIG': return config.contracts.treasuryTokenZW;
    default:    return '';
  }
}

export async function deployTreasuryToken(currencyCode: string): Promise<DeployTreasuryResult> {
  const code = currencyCode.toUpperCase();
  const admin    = deployerAdminAddress();
  const vault    = config.contracts.vault;
  const consumer = config.contracts.consumer;
  const backend  = process.env['BACKEND_SIGNER_ADDRESS'] ?? '';

  if (!admin) throw new Error('DEPLOYER_ADMIN_ADDRESS is not configured');
  if (!vault) throw new Error('VAULT_CONTRACT_ADDRESS is not configured');
  if (!consumer) throw new Error('CONSUMER_CONTRACT_ADDRESS is not configured');
  if (!/^0x[0-9a-fA-F]{40}$/.test(backend)) throw new Error('BACKEND_SIGNER_ADDRESS is not configured');

  const cur = await db.query<{
    currency_code: string; name: string; currency_type: string; base_currency_code: string | null;
  }>(
    `SELECT currency_code, name, currency_type, base_currency_code FROM currencies WHERE currency_code = $1`,
    [code],
  );
  if (!cur.rows.length) throw new Error(`Currency ${code} not found`);
  const row = cur.rows[0];
  if (row.currency_type !== 'TREASURY') throw new Error(`${code} is not a TREASURY currency`);

  let fiatCode = row.base_currency_code?.toUpperCase() ?? '';
  if (!fiatCode) {
    const inferred = await db.query<{ currency_code: string }>(
      `SELECT currency_code FROM countries
        WHERE country_code = SUBSTRING($1 FROM 3) OR $1 = 'TT' || country_code
        LIMIT 1`,
      [code],
    );
    if (inferred.rows.length) fiatCode = inferred.rows[0].currency_code;
  }
  if (!fiatCode) {
    throw new Error(`${code} has no base_currency_code (fiat anchor, e.g. MWK). Set it before deploying.`);
  }

  const existing = await db.query<{ contract_address: string | null; is_deployed: boolean }>(
    `SELECT contract_address, is_deployed FROM stablecoins WHERE internal_code = $1`,
    [code],
  );
  if (existing.rows[0]?.is_deployed && existing.rows[0]?.contract_address) {
    throw new Error(`${code} is already deployed at ${existing.rows[0].contract_address}`);
  }

  const wallet = deployerWallet();
  const sharedImpl = await getSharedTreasuryImplementation();
  const initialSupply = BigInt(process.env['INITIAL_SUPPLY'] ?? '0');
  const { proxy, txHash } = await deployTreasuryProxyInstance(wallet, row.name, code, admin, initialSupply);

  const vaultContract = new ethers.Contract(vault, VAULT_WIRE_ABI, wallet);
  const tt = new ethers.Contract(proxy, [...TT_INIT_ABI, ...TT_ROLES_ABI], wallet);

  const wireTxs: ethers.ContractTransactionResponse[] = [];
  wireTxs.push(await vaultContract.setCurrencyTreasuryToken(currencyHash(fiatCode), proxy));
  const minterRole = await tt.MINTER_ROLE() as string;
  const complianceRole = await tt.COMPLIANCE_ROLE() as string;
  wireTxs.push(await tt.grantRole(minterRole, vault));
  wireTxs.push(await tt.grantRole(minterRole, backend));
  wireTxs.push(await tt.grantRole(complianceRole, backend));
  wireTxs.push(await tt.setConsumerContract(consumer));
  wireTxs.push(await tt.setComplianceEnabled(true));
  wireTxs.push(await tt.addToWhitelist(admin));

  for (const wtx of wireTxs) {
    const rcpt = await wtx.wait();
    if (rcpt) await recordDeployGas(rcpt, `contract_deploy:TreasuryToken:${code}:wire`);
  }

  await db.query(
    `UPDATE currencies SET base_currency_code = $2, updated_at = NOW()
     WHERE currency_code = $1 AND (base_currency_code IS NULL OR base_currency_code = '')`,
    [code, fiatCode],
  );

  await db.query(
    `INSERT INTO stablecoins (internal_code, currency_code, contract_address, is_primary, is_treasury_token, is_deployed)
     VALUES ($1, $1, $2, FALSE, TRUE, TRUE)
     ON CONFLICT (internal_code) DO UPDATE
       SET contract_address = $2, is_treasury_token = TRUE, is_deployed = TRUE, updated_at = NOW()`,
    [code, proxy.toLowerCase()],
  );

  return {
    currencyCode: code,
    fiatCode,
    proxyAddress: proxy,
    implementationAddress: sharedImpl,
    deployTx: txHash,
    wired: true,
  };
}

/** Align instances to shared impl; remove stray per-corridor contract_deployments rows. */
export async function reconcileTreasuryInstances(): Promise<{ aligned: string[]; removed: string[] }> {
  const aligned: string[] = [];
  for (const inst of await listTreasuryInstances()) {
    if (inst.proxy_address) {
      await alignInstanceToSharedImplementation(inst.proxy_address);
      aligned.push(inst.symbol);
    }
  }
  const removed = await db.query<{ contract_name: string }>(
    `DELETE FROM contract_deployments
      WHERE contract_name LIKE 'TreasuryToken%'
        AND contract_name <> 'TreasuryToken'
     RETURNING contract_name`,
  );
  return { aligned, removed: removed.rows.map(r => r.contract_name) };
}
