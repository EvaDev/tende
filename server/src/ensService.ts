// ensService.ts — Gwei Name Service (GNS) registration for consumer payment tags.
// Parent domain (e.g. imali.gwei) is an NFT on https://gwei.domains — not classic ENS.
//
// Architecture:
//   - NameNFT (same address on mainnet + Sepolia): ownership + resolver
//   - Parent owner calls registerSubdomain(label, parentId) then setAddr(tokenId, wallet)
//   - Payment resolution in-app still uses keccak256(bare tag) on Consumer.sol;
//     GNS makes se1.imali.gwei resolvable externally (wallets, explorers, etc.)
//
// ENS_CONTROLLER_* must be the wallet that owns the parent .gwei name NFT.

import { ethers } from 'ethers';
import config from './config.js';
import type { EnsRegistrationResult, EnsSkipResult } from './types.js';

const GNS_ABI = [
  'function computeId(string fullName) pure returns (uint256)',
  'function resolve(uint256 tokenId) view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function registerSubdomain(string label, uint256 parentId) returns (uint256 tokenId)',
  'function registerSubdomainFor(string label, uint256 parentId, address to) returns (uint256 tokenId)',
  'function setAddr(uint256 tokenId, address addr)',
];

function getGnsProvider(): ethers.JsonRpcProvider {
  // GNS is deployed at the same addresses on mainnet and Sepolia; use the app chain.
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

function getGnsSigner(): ethers.Wallet {
  if (!config.ens.controllerKey) {
    throw new Error('ENS_CONTROLLER_PRIVATE_KEY is not set. Cannot register .gwei subdomains.');
  }
  return new ethers.Wallet(config.ens.controllerKey, getGnsProvider());
}

function gnsContract(runner: ethers.Provider | ethers.Wallet): ethers.Contract {
  return new ethers.Contract(config.ens.gnsContract, GNS_ABI, runner);
}

export const ensService = {
  get parentDomain(): string {
    return config.ens.parentDomain;
  },

  get systemLabel(): string {
    return 'GNS';
  },

  fullName(subdomain: string): string {
    const label = subdomain.toLowerCase().trim();
    const parent = config.ens.parentDomain.toLowerCase().replace(/^\.+/, '');
    return `${label}.${parent}`;
  },

  async parentTokenId(): Promise<bigint> {
    const gns = gnsContract(getGnsProvider());
    return gns.computeId(config.ens.parentDomain.toLowerCase()) as Promise<bigint>;
  },

  async registerSubdomain({ subdomain, walletAddress }: {
    subdomain: string;
    walletAddress: string;
  }): Promise<EnsRegistrationResult | EnsSkipResult> {
    if (!config.ens.controllerAddress) {
      console.warn('[ens] ENS_CONTROLLER_ADDRESS not set — skipping GNS registration');
      return { skipped: true, reason: 'no_controller' };
    }

    const label = subdomain.toLowerCase().trim();
    if (!/^[a-z0-9-]{1,32}$/.test(label)) {
      throw new Error(`Invalid subdomain label: ${subdomain}`);
    }

    const signer = getGnsSigner();
    if (signer.address.toLowerCase() !== config.ens.controllerAddress.toLowerCase()) {
      throw new Error(
        `ENS_CONTROLLER_PRIVATE_KEY does not match ENS_CONTROLLER_ADDRESS ` +
        `(key→${signer.address}, env→${config.ens.controllerAddress})`,
      );
    }

    const gns = gnsContract(signer);
    const fullName = this.fullName(label);
    const parentId = await gns.computeId(config.ens.parentDomain.toLowerCase()) as bigint;
    const parentOwner = await gns.ownerOf(parentId) as string;
    if (parentOwner.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(
        `${config.ens.parentDomain} is owned by ${parentOwner}, not controller ${signer.address}`,
      );
    }

    // Mint/reclaim subdomain NFT to the parent owner, then point addr at the Safe.
    const tx1 = await gns.registerSubdomain(label, parentId);
    const rcpt1 = await tx1.wait();
    const tokenId = await gns.computeId(fullName) as bigint;

    const tx2 = await gns.setAddr(tokenId, walletAddress);
    const rcpt2 = await tx2.wait();

    console.log(
      `[ens] registered ${fullName} → ${walletAddress} ` +
      `(subdomain tx ${rcpt1?.hash}, setAddr tx ${rcpt2?.hash})`,
    );

    return { subdomain: label, fullName, walletAddress, resolved: true };
  },

  async resolveSubdomain(subdomain: string): Promise<string | null> {
    const gns = gnsContract(getGnsProvider());
    const tokenId = await gns.computeId(this.fullName(subdomain)) as bigint;
    const addr = await gns.resolve(tokenId) as string;
    if (!addr || addr === ethers.ZeroAddress) return null;
    return ethers.getAddress(addr);
  },

  async isSubdomainAvailable(subdomain: string): Promise<boolean> {
    const gns = gnsContract(getGnsProvider());
    const tokenId = await gns.computeId(this.fullName(subdomain)) as bigint;
    try {
      await gns.ownerOf(tokenId);
      return false; // minted → taken (parent can still reclaim via registerSubdomain)
    } catch {
      return true;
    }
  },
};

export default ensService;
