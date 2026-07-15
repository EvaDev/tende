# iMali — System Database Design Specification
**Stream 4: System Data & Backend Services**
Version 0.1 — June 2026

---

## Architecture decision: one database, four logical domains

**Decision: single PostgreSQL database.**

Merchant bank details, KYC limits, product catalogues, and consumer records are operationally coupled on every payment transaction. A payment resolves the consumer's KYC limits, looks up the merchant product and its supplier API code, routes settlement via the merchant's off-ramp config, and emits an on-chain event — all in one flow. Splitting this into two databases adds join complexity, distributed transaction risk, and operational overhead at a stage where the team is small. Domain boundaries are enforced via naming conventions and access patterns instead.

The four logical domains map to table prefixes and can be split into separate schemas (`system_config`, `merchant`, `consumer`, `events`) if the codebase grows to warrant it.

---

## Domain 1: system_config

Core reference data owned and edited only by admins via the server UI.

### `currencies`
Three roles, controlled by `currency_type`:

| Type | Example rows | `base_currency_code` | `stablecoin_address` |
|------|-------------|----------------------|----------------------|
| `FIAT` | ZAR, USD, KES | self (or null) | null |
| `STABLECOIN` | ZARP, USDC | ZAR, USD | ERC20 address |
| `TREASURY` | TTZA | ZAR | ERC20 address |

The `base_currency_code` always answers: *"one unit of this token represents which fiat economic unit?"* This is how the consumer UI can show balances in ZAR regardless of whether the underlying token is TTZA or ZARP.

**Design note from shared.cairo**: The Cairo struct originally used a single `Currency` row for both fiat and tokens. The DB follows the same model — FIAT rows are country anchors, STABLECOIN/TREASURY rows are on-chain token descriptors. The `stablecoins` table holds the deployment-specific data (contract address, supply cache) so that `currencies` remains clean reference data.

### `countries`
One row per operating jurisdiction. Controls: VAT rate applied to products, dial code for mobile-number validation, and which KYC levels are available. Matches the Countries screen in the server UI exactly.

### `stablecoins`
Deployment registry. The indexer updates `total_supply` from on-chain events. `is_deployed` gates the UI — undeployed tokens appear in admin only. `is_primary` marks the preferred spend token for each fiat (currently none marked primary — consumer can hold both TTZA and ZARP).

### `kyc_levels`
Per-country compliance limit tiers. All monetary amounts stored in **fiat cents** (smallest unit of the country's fiat currency) to avoid floating-point issues.

**Feature gates on each level:**
- `allows_usd_savings` — gates access to the USD vault wallet
- `allows_remittance` — gates cross-border P2P send
- `idos_credential_required` — whether an idOS credential must be verified before this level is granted
- `requires_biometric` — whether FaceSign/liveness check is mandatory

**Open question**: Do KYC limits apply to the *combined* multi-stablecoin balance, or per-token? The current schema enforces limits at the transaction level in the application layer using the consumer's country's fiat-equivalent value. This needs a confirmed answer before the consumer wallet spend path is built.

---

## Domain 2: merchant

### `merchants`
Core merchant record. Key design choices:

- `wallet_address`: the merchant's on-chain settlement wallet. Also used as the auth key on the server UI (Connect Wallet to Register). This mirrors the existing UI pattern.
- `idos_credential_id`: once idOS integration is live, merchant KYC moves here. Until then, verification_status is admin-managed.
- `primary1_color` / `primary2_color`: hex strings (no `#`). The consumer UI reads these for white-label embedding. An empty value falls back to iMali defaults (yellow `FFEA00` / blue `0033A0`).
- `logo_arweave_id`: Arweave transaction ID. The admin wallet owns the Arweave wallet; the server UI uploads and stores the tx ID here. The consumer UI constructs the full URL as `https://arweave.net/{logo_arweave_id}`.

### `merchant_offramp_config`
Deliberately separate from `merchants` — a merchant may have multiple off-ramp routes (e.g. EFT primary, crypto fallback), and this will grow as off-ramp partners are added. `auto_settle` flag enables automatic settlement trigger when the merchant's on-chain balance crosses `min_settlement_amount`.

**Security note**: `bank_account_number` and `bank_branch_code` must be encrypted at rest using AES-256 at the application layer. The DB stores ciphertext. Key management via environment variable or a secrets manager (Doppler / AWS Secrets Manager).

### `products` and `product_skus`
Product catalogue lives here, not on-chain (confirmed). Key integration fields:

- `external_product_id`: maps to the legacy 1V product ID or Flash PIM `pimId`. Used to upsert API-synced rows and route fulfilment.
- `supplier_api_code`: the third-party supplier's product code (e.g. for airtime, electricity).
- `barcode`: POS / supplier barcode (e.g. Flash Internal Barcode).
- `brand`: marketing brand (e.g. Flash PIM `baseProduct.brand` = 1Voucher).
- `category`: product category (e.g. Flash PIM `productCategory` = eVoucher).
- `fulfilment_url`: HTTP endpoint called after payment; funds stay in platform escrow until success (release → merchant) or failure (refund → consumer). Defaults to the mock fulfilment API.
- `source`: `manual` (merchant-created) or `api` (synced from `merchants.catalog_api_url`).
- `delivery_type`: `DIRECT` (in person), `VOUCHER`, `PHYSICAL`, `VIRTUAL` (VAS). All types can appear on Point of Sale.

The `category` / `subcategory` fields are a simplified version of the full 1V Division → Category → SubCategory → Group hierarchy. The commented-out Cairo structs (`Division`, `Category`, `SubCategory`, `Group`) can be revived as DB tables if the full hierarchy is needed for the consumer browse experience. For the initial build, flat category/subcategory strings are sufficient.

---

## Domain 3: consumer

### `consumers`
**Privacy-first design**: no PII stored in this table.

| Field | What's stored | Why not plaintext |
|-------|--------------|-------------------|
| `mobile_hash` | SHA-256 of E.164 mobile | POPIA / GDPR — mobile is PII |
| `display_name_hash` | SHA-256 of display name | mirrors shared.cairo approach |
| `idos_credential_id` | idOS DID reference | actual KYC docs live in idOS |

Actual name, mobile number, email, and identity documents live either in the legacy web2 system (for `source_system = 'WEB2'`) or in idOS (for `source_system = 'ONCHAIN'`).

**Migration state machine:**
```
WEB2 → MIGRATING → ONCHAIN
```
A consumer enters `MIGRATING` when they opt into a feature requiring on-chain identity (USD savings, remittance). During migration: a new ERC4337 wallet is created, their web2 balance is swept to TTZA on-chain, and `legacy_consumer_id` is preserved for transaction history lookback. The web2 account is then deactivated. This is a one-way transition.

### `consumer_merchant_links`
Mirrors `MerchantConsumer` from shared.cairo. The `source_id` is the merchant's internal customer ID (e.g. their loyalty card number). The `ens_subdomain` column holds the relationship-specific GNS payment tag (legacy column name).

---

## Domain 4: events (on-chain index)

### `onchain_events`
Append-only table, written by the indexer service (Stream 4b). Never updated in place — if a block is reorged, the status is set to `REORGED` and a corrected row is inserted.

`raw_log` (JSONB) stores the complete Ethereum event log. This enables reprocessing without re-indexing from the chain — critical during the early deployment phase when the event schema may change.

**Key event types and their business meaning:**

| Event type | Trigger | Business significance |
|------------|---------|----------------------|
| `MINT` | Cash-in confirmed, fiat received | New tokens enter circulation; must be 1:1 with fiat deposit |
| `BURN` | Cash-out confirmed | Tokens leave circulation; must be 1:1 with fiat payout |
| `MERCHANT_PAYMENT` | Consumer spend | Revenue event; triggers settlement routing |
| `YIELD_ISSUED` | Scheduled yield distribution | USD savings yield; shared between consumer and platform |
| `CONTRACT_DEPLOYED` | Admin deploys new contract | Audit trail for contract lifecycle |

---

## What's not in this database

| Data | Where it lives | Why |
|------|---------------|-----|
| Consumer PII (name, mobile, ID docs) | idOS / legacy web2 DB | Privacy regulation (POPIA) |
| On-chain balances | Ethereum / StarkNet | Source of truth is the chain; DB caches via events |
| Merchant passwords / session tokens | JWT in memory / Redis | Not persisted to DB |
| Paymaster ETH balance | Pimlico API / chain | Read-only via RPC; no local store needed |
| Arweave image blobs | Arweave network | Content-addressed; only tx ID stored here |
| Remittance rate quotes | Aggregator APIs (Phase 2) | Ephemeral; cached in Redis if needed |

---

## Open questions requiring answers before build

1. **KYC limit enforcement scope**: Are limits enforced against the combined multi-token balance (summed at current FX rate) or per-token? This affects the spend validation query on every transaction.

2. **Product catalogue ownership**: Can a merchant admin their own products via the server UI immediately after registration, or only after admin verification? This determines whether `products` need a `pending_review` status.

3. **Consumer lookup in spend path**: When a consumer presents at a merchant QR checkout, the lookup is by `wallet_address`. But for legacy web2 consumers (no wallet yet), the QR flow needs a fallback. Is this a mobile-number lookup (hashed), or does the legacy system stay separate for web2 consumers?

4. **Multi-currency wallet balances**: A ZA consumer can hold TTZA and ZARP simultaneously. The `consumers` table stores wallet addresses but not balances (those are on-chain). The server UI "Top up" and "Paymaster" screens may need a cached balance view — should we add a `consumer_balance_cache` table updated by the indexer, or always read live from chain?

---

## Next steps

Once this schema is approved:
1. Create the Node.js/Express API endpoints for the Countries and Currencies pages (already have working UI screenshots to match)
2. Seed the KYC levels for all 9 active countries (currently only ZA seeded)
3. Wire the merchant registration flow to write to `merchants` and `merchant_offramp_config`
4. Design the indexer service schema (Stream 4b) — how often to poll, how to handle reorgs, which events to prioritise
