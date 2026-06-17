// src/config.ts
// Reads and validates all environment variables at startup.
// Import this module everywhere — never read process.env directly.
// The app will fail fast with a clear error if required vars are missing.

import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const config = {
  server: {
    env:      optional('NODE_ENV', 'development'),
    port:     parseInt(optional('PORT', '5173')),
    logLevel: optional('LOG_LEVEL', 'info'),
  },

  db: {
    url: required('DATABASE_URL'),
  },

  jwt: {
    secret:    required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '8h'),
  },

  chain: {
    // Derive RPC URL from CHAIN_ID so both server and Foundry share the same
    // RPC_URL_MAINNET / RPC_URL_SEPOLIA vars — no separate RPC_URL needed.
    get rpcUrl(): string {
      const id = parseInt(required('CHAIN_ID'));
      if (id === 1)        return required('RPC_URL_MAINNET');
      if (id === 11155111) return required('RPC_URL_SEPOLIA');
      // Fallback: allow an explicit RPC_URL override for other networks
      const override = process.env['RPC_URL'];
      if (override) return override;
      throw new Error(`No RPC URL configured for CHAIN_ID=${id}. Set RPC_URL_MAINNET, RPC_URL_SEPOLIA, or RPC_URL.`);
    },
    chainId: parseInt(required('CHAIN_ID')),
  },

  contracts: {
    consumer:        optional('CONSUMER_CONTRACT_ADDRESS'),
    vault:           optional('VAULT_CONTRACT_ADDRESS'),
    treasuryTokenZA: optional('TREASURY_TOKEN_ZA_ADDRESS'),
  },

  safe: {
    singleton:             required('SAFE_SINGLETON_ADDRESS'),
    proxyFactory:          required('SAFE_PROXY_FACTORY_ADDRESS'),
    fallbackHandler:       optional('SAFE_FALLBACK_HANDLER_ADDRESS'),
    webAuthnSignerFactory: required('SAFE_WEBAUTHN_SIGNER_FACTORY_ADDRESS'),
  },

  pimlico: {
    apiKey:     required('PIMLICO_API_KEY'),
    bundlerUrl: required('PIMLICO_BUNDLER_URL'),
  },

  ens: {
    parentDomain:      optional('ENS_PARENT_DOMAIN', '1voucher.eth'),
    controllerAddress: optional('ENS_CONTROLLER_ADDRESS'),
    controllerKey:     optional('ENS_CONTROLLER_PRIVATE_KEY'),
    resolverAddress:   optional('ENS_RESOLVER_ADDRESS'),
  },

  idos: {
    mode:                   optional('IDOS_MODE', 'stub'),
    nodeUrl:                optional('IDOS_NODE_URL', 'https://nodes.idos.network'),
    issuerSigningKey:       optional('IDOS_ISSUER_SIGNING_SECRET_KEY'),
    issuerEncryptionKey:    optional('IDOS_ISSUER_ENCRYPTION_SECRET_KEY'),
    issuerMultibasePrivate: optional('IDOS_ISSUER_MULTIBASE_PRIVATE_KEY'),
    issuerMultibasePublic:  optional('IDOS_ISSUER_MULTIBASE_PUBLIC_KEY'),
    issuerUri:              optional('IDOS_ISSUER_URI', 'https://api.imali.app/idos'),
    consumerEncryptionKey:  optional('IDOS_CONSUMER_ENCRYPTION_PRIVATE_KEY'),
    consumerSignerKey:      optional('IDOS_CONSUMER_SIGNER_PRIVATE_KEY'),
  },

  backend: {
    // Hot wallet private key — signs onchain txs from the server.
    // This is NOT the contract admin/owner wallet (ADMIN_ADDRESS in deploy .env).
    privateKey: required('BACKEND_SIGNER_PRIVATE_KEY'),
  },

  vault: {
    mode: optional('VAULT_MODE', 'poc'),
  },

  arweave: {
    walletPath: optional('ARWEAVE_WALLET_JSON_PATH', './secrets/arweave-wallet.json'),
  },
} as const;

// Validate ENS config is present when contracts are deployed
if (config.contracts.consumer && !config.ens.controllerAddress) {
  console.warn('[config] WARNING: CONSUMER_CONTRACT_ADDRESS is set but ENS_CONTROLLER_ADDRESS is not. ENS registration will fail.');
}

if (config.idos.mode === 'stub') {
  console.warn('[config] idOS is in STUB mode. Set IDOS_MODE=live after permissioned issuer approval.');
}

export default config;
