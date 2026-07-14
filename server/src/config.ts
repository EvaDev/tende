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
    port:     parseInt(optional('PORT', '3001')),
    logLevel: optional('LOG_LEVEL', 'info'),
  },

  // Allowed browser origins for credentialed API calls in production.
  cors: {
    get origins(): string[] {
      return optional(
        'CORS_ORIGINS',
        'https://app.imali.app,https://admin.imali.app,https://merchant.imali.app',
      ).split(',').map(s => s.trim()).filter(Boolean);
    },
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
    get mainnetRpcUrl(): string { return required('RPC_URL_MAINNET'); },
    chainId: parseInt(required('CHAIN_ID')),
  },

  contracts: {
    consumer:        optional('CONSUMER_CONTRACT_ADDRESS'),
    vault:           optional('VAULT_CONTRACT_ADDRESS'),
    treasuryTokenZA: optional('TREASURY_TOKEN_ZA_ADDRESS'),
    treasuryTokenZW: optional('TREASURY_TOKEN_ZW_ADDRESS'),
    sessionTransferModule: optional('SESSION_TRANSFER_MODULE_ADDRESS'),
  },

  safe: {
    singleton:             required('SAFE_SINGLETON_ADDRESS'),
    proxyFactory:          required('SAFE_PROXY_FACTORY_ADDRESS'),
    fallbackHandler:       optional('SAFE_FALLBACK_HANDLER_ADDRESS'),
    webAuthnSignerFactory: required('SAFE_WEBAUTHN_SIGNER_FACTORY_ADDRESS'),
    // P-256 verifier (FCLP256Verifier) used by the WebAuthn signer factory.
    // `verifiers` is a uint176 = (precompile<<160)|fallbackVerifier. Sepolia has
    // no RIP-7212 precompile, so precompile=0 and verifiers = BigInt(verifier addr).
    p256Verifier:          optional('SAFE_P256_VERIFIER_ADDRESS', '0x445a0683e494ea0c5AF3E83c5159fBE47Cf9e765'),
    get webAuthnVerifiers(): bigint { return BigInt(this.p256Verifier as string); },
  },

  // WebAuthn relying party — must match the calling app's origin/host. Now two
  // apps do WebAuthn ceremonies (consumer:5173, merchant:5175), so this accepts
  // a comma-separated list; `origin` (singular) stays as the first entry for
  // call sites that just need one canonical URL (e.g. building a claim link).
  webauthn: {
    rpId:   optional('WEBAUTHN_RP_ID', 'localhost'),
    rpName: optional('WEBAUTHN_RP_NAME', 'iMali'),
    get origins(): string[] {
      return optional('WEBAUTHN_ORIGIN', 'http://localhost:5173,http://localhost:5175')
        .split(',').map(s => s.trim()).filter(Boolean);
    },
    get origin(): string { return this.origins[0]; },
  },

  pimlico: {
    apiKey:             required('PIMLICO_API_KEY'),
    bundlerUrl:         required('PIMLICO_BUNDLER_URL'),
    sponsorshipPolicy:  required('PIMLICO_SPONSORSHIP_POLICY_ID'),
    webhookSecret:      required('PIMLICO_WEBHOOK_SECRET'),
  },

  ens: {
    // Gwei Name Service (https://gwei.domains) — parent e.g. imali.gwei
    parentDomain:      optional('ENS_PARENT_DOMAIN', 'imali.gwei'),
    controllerAddress: optional('ENS_CONTROLLER_ADDRESS'),
    controllerKey:     optional('ENS_CONTROLLER_PRIVATE_KEY'),
    // NameNFT — same CREATE address on mainnet and Sepolia
    gnsContract:       optional('GNS_CONTRACT_ADDRESS', '0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6'),
    // Legacy ENS Public Resolver (unused by GNS; kept optional for older envs)
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

  platform: {
    // Treasury that receives the platform's cut of vault yield on harvest().
    // Defaults to the owner wallet (DEPLOYER_ADMIN_ADDRESS); falls back to it when
    // PLATFORM_TREASURY_ADDRESS is unset.
    treasuryAddress: optional('PLATFORM_TREASURY_ADDRESS') || optional('DEPLOYER_ADMIN_ADDRESS'),
    // Default platform share of harvested yield, in basis points (1000 = 10%).
    harvestFeeBps:   parseInt(optional('PLATFORM_HARVEST_FEE_BPS', '1000')),
    // Spend-cash currencies — flat 1:1 to consumers, so ALL their yield goes to the
    // protocol (harvest forced to 100%). Comma-separated currency codes.
    cashCurrencies:  optional('PLATFORM_CASH_CURRENCIES', 'ZAR').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    // On-chain account that holds unclaimed spend-voucher value (domestic; released
    // to the KYC'd beneficiary on claim). Defaults to the treasury / owner wallet.
    escrowAddress:   optional('PLATFORM_ESCROW_ADDRESS') || optional('PLATFORM_TREASURY_ADDRESS') || optional('DEPLOYER_ADMIN_ADDRESS'),
  },

  vault: {
    mode: optional('VAULT_MODE', 'poc'),
  },

  indexer: {
    enabled:       optional('INDEXER_ENABLED', 'true') !== 'false',
    // First-run start block. Unset → start at the current head (forward-only), which
    // avoids a slow historical catch-up on a rate-limited RPC. Set to the deploy
    // block to backfill history.
    startBlock:    process.env['INDEXER_START_BLOCK'] ? parseInt(process.env['INDEXER_START_BLOCK']) : null,
    // Alchemy's free tier caps eth_getLogs at a 10-block range — keep chunks <= 10.
    chunkBlocks:   parseInt(optional('INDEXER_CHUNK_BLOCKS', '10')),
    confirmations: parseInt(optional('INDEXER_CONFIRMATIONS', '5')),
    pollMs:        parseInt(optional('INDEXER_POLL_MS', '15000')),
  },

  fx: {
    // Live FX provider. When no key is set the service falls back to admin-set
    // overrides in fx_rate_overrides. ZimRate covers exotic ZWG pairs;
    // open.er-api covers majors. Rates are cached in-memory for cacheTtlMs.
    provider:     optional('FX_PROVIDER', 'zimrate'),
    apiKey:       optional('FX_PROVIDER_API_KEY'),
    zimrateUrl:   optional('FX_ZIMRATE_URL', 'https://zimrate.statotec.com/api/v1/rates'),
    majorsUrl:    optional('FX_MAJORS_URL', 'https://open.er-api.com/v6/latest'),
    cacheTtlMs:   parseInt(optional('FX_CACHE_TTL_MS', '300000')), // 5 min
  },

  dex: {
    // Uniswap V3 QuoterV2 + USDC on mainnet (where the listed assets have liquidity).
    // Used read-only (eth_call) to price assets — no on-chain oracle, no transaction.
    quoterV2:     optional('DEX_QUOTER_V2', '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
    usdcAddress:  optional('DEX_USDC_ADDRESS', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    usdcDecimals: 6,
    cacheTtlMs:   parseInt(optional('DEX_QUOTE_TTL_MS', '60000')), // 1 min
  },

  arweave: {
    walletPath: optional('ARWEAVE_WALLET_JSON_PATH', './secrets/arweave-wallet.json'),
  },
} as const;

// Validate GNS (.gwei) config is present when contracts are deployed
if (config.contracts.consumer && !config.ens.controllerAddress) {
  console.warn('[config] WARNING: CONSUMER_CONTRACT_ADDRESS is set but ENS_CONTROLLER_ADDRESS is not. .gwei subdomain registration will fail.');
}

if (config.idos.mode === 'stub') {
  console.warn('[config] idOS is in STUB mode. Set IDOS_MODE=live after permissioned issuer approval.');
}

export default config;
