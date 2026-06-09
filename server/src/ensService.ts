// src/ensService.ts
// Handles ENS subdomain registration for consumer wallets.
// The parent domain (e.g. imali.eth) is read from config,
// making it trivial to switch domains or move to a new controller wallet.
//
// ENS architecture:
//   - Parent domain (imali.eth) is controlled by ENS_CONTROLLER_ADDRESS
//   - Consumer subdomains (sean.imali.eth) are set via setSubnodeRecord
//   - The Public Resolver maps the subdomain → wallet address
//
// IMPORTANT: ENS_CONTROLLER_ADDRESS must be a fresh wallet with ownership of
// the parent domain transferred to it before mainnet.

import { ethers, namehash, keccak256, toUtf8Bytes } from 'ethers';
import config from './config.js';
import type { EnsRegistrationResult, EnsSkipResult } from './types.js';

const ENS_REGISTRY_ABI = [
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
  'function owner(bytes32 node) view returns (address)',
];

const PUBLIC_RESOLVER_ABI = [
  'function setAddr(bytes32 node, address addr)',
  'function addr(bytes32 node) view returns (address)',
];

// ENS Registry address is identical on all EVM networks
const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

function getEnsProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.chain.rpcUrl);
}

function getEnsSigner(): ethers.Wallet {
  if (!config.ens.controllerKey) {
    throw new Error('ENS_CONTROLLER_PRIVATE_KEY is not set. Cannot register ENS subdomains.');
  }
  return new ethers.Wallet(config.ens.controllerKey, getEnsProvider());
}

export const ensService = {
  get parentDomain(): string {
    return config.ens.parentDomain;
  },

  fullName(subdomain: string): string {
    return `${subdomain}.${config.ens.parentDomain}`;
  },

  async registerSubdomain({ subdomain, walletAddress }: {
    subdomain: string;
    walletAddress: string;
  }): Promise<EnsRegistrationResult | EnsSkipResult> {
    if (!config.ens.controllerAddress) {
      console.warn('[ens] ENS_CONTROLLER_ADDRESS not set — skipping ENS registration');
      return { skipped: true, reason: 'no_controller' };
    }

    const signer   = getEnsSigner();
    const registry = new ethers.Contract(ENS_REGISTRY_ADDRESS, ENS_REGISTRY_ABI, signer);
    const resolver = new ethers.Contract(config.ens.resolverAddress, PUBLIC_RESOLVER_ABI, signer);

    const parentNode = namehash(config.ens.parentDomain);
    const labelHash  = keccak256(toUtf8Bytes(subdomain));
    const subNode    = namehash(this.fullName(subdomain));

    const tx1 = await registry.setSubnodeRecord(
      parentNode,
      labelHash,
      config.ens.controllerAddress,
      config.ens.resolverAddress,
      0,
    );
    await tx1.wait();

    const tx2 = await resolver.setAddr(subNode, walletAddress);
    await tx2.wait();

    return { subdomain, fullName: this.fullName(subdomain), walletAddress, resolved: true };
  },

  async resolveSubdomain(subdomain: string): Promise<string | null> {
    const provider = getEnsProvider();
    return provider.resolveName(this.fullName(subdomain));
  },

  async isSubdomainAvailable(subdomain: string): Promise<boolean> {
    const provider = getEnsProvider();
    const subNode  = namehash(this.fullName(subdomain));
    const registry = new ethers.Contract(ENS_REGISTRY_ADDRESS, ENS_REGISTRY_ABI, provider);
    const owner    = await registry.owner(subNode) as string;
    return owner === ethers.ZeroAddress;
  },
};

export default ensService;
