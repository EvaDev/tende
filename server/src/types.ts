// src/types.ts
// Shared domain types used across routes and services.
// Keep this file free of imports to avoid circular deps.

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface ConsumerJwtPayload {
  sub: string;          // wallet address (lowercase)
  consumerId: string;
  countryCode: string;
  kycLevel: number | null;
  role: 'consumer' | 'admin' | 'merchant';
  iat?: number;
  exp?: number;
}

// Attached to req by requireAuth / requireAdmin
export interface AuthedRequest extends Express.Request {
  consumer: { walletAddress: string; consumerId: string };
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

export interface ConsumerRow {
  consumer_id: string;
  mobile_hash: string | null;
  display_name_hash: string | null;
  country_code: string;
  kyc_level_id: number | null;
  wallet_address: string | null;
  save_wallet_address: string | null;
  usd_wallet_address: string | null;
  idos_credential_id: string | null;
  ens_subdomain: string | null;
  source_system: 'WEB2' | 'ONCHAIN' | 'MIGRATING';
  legacy_consumer_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface KycLevelRow {
  level_id: number;
  country_code: string;
  level_name: string;
  max_single_tx: string | null;
  max_daily_spend: string | null;
  max_monthly_spend: string | null;
  max_wallet_balance: string | null;
  max_daily_send: string | null;
  requires_id_doc: boolean;
  requires_biometric: boolean;
  allows_usd_savings: boolean;
  allows_remittance: boolean;
  allows_merchant_spend: boolean;
  idos_credential_required: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CountryRow {
  country_code: string;
  name: string;
  currency_code: string;
  vat_rate_pct: string;
  dial_code: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CurrencyRow {
  currency_code: string;
  name: string;
  currency_symbol: string | null;
  decimals: number;
  base_currency_code: string | null;
  currency_type: 'FIAT' | 'STABLECOIN' | 'TREASURY';
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StablecoinRow {
  internal_code: string;
  currency_code: string;
  contract_address: string | null;
  is_primary: boolean;
  is_treasury_token: boolean;
  is_deployed: boolean;
  total_supply: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MerchantRow {
  merchant_id: string;
  name: string;
  country_code: string;
  currency_code: string;
  wallet_address: string | null;
  idos_credential_id: string | null;
  verification_status: 'PENDING' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | 'REJECTED';
  kyc_level_id: number | null;
  primary1_color: string | null;
  primary2_color: string | null;
  logo_arweave_id: string | null;
  email: string | null;
  website: string | null;
  settlement_currency: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OnchainEventRow {
  event_id: string;
  tx_hash: string;
  event_type: string;
  from_address: string | null;
  to_address: string | null;
  amount: string | null;
  currency_code: string | null;
  consumer_id: string | null;
  merchant_id: string | null;
  block_number: number | null;
  block_timestamp: Date | null;
  chain_id: number;
  contract_address: string | null;
  log_index: number | null;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REORGED';
  indexed_at: Date;
  raw_log: object | null;
}

// ── Service return types ───────────────────────────────────────────────────────

export interface EnsRegistrationResult {
  subdomain: string;
  fullName: string;
  walletAddress: string;
  resolved: boolean;
}

export interface EnsSkipResult {
  skipped: true;
  reason: string;
}

export interface IdosCredentialResult {
  credentialId: string;
  accessGrantId: string;
}

export interface PimlicoWhitelistResult {
  whitelisted: boolean;
  wallet: string;
  result?: unknown;
}

export interface RegistrationResult {
  success: boolean;
  walletAddress: string;
  globalConsumerId: number;
  consumerId: string;
  ensSubdomain: string | null;
  steps: Record<string, unknown>;
}
