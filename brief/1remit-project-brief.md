# 1Remit — Living Project Brief
> Paste this entire document at the start of every Claude session to restore full context.
> After each session: update **Current Build State** and move completed Backlog items to Built.
> Last updated: [UPDATE THIS DATE EACH SESSION]

---

## 0. How to Use This Brief

**Starting a new session:**
1. Paste this entire document
2. Attach the relevant `.sol` files you're working on
3. State which Backlog item you want to tackle

**Example opener:**
> "Here is the 1Remit project brief [paste]. Attached: Vault.sol, Consumer.sol, TreasuryToken.sol, DataTypes.sol. Please implement Backlog Item A."

**After each session:**
- Move completed items to section 6 (Current Build State) with ✅
- Update any design decisions that changed
- Add new backlog items that emerged
- Update the date at the top

---

## 1. Coding Standards — ethskills Reference (MANDATORY)

**All EVM/Solidity work in this project must align with the ethskills reference:**
> https://github.com/austintgriffith/ethskills/blob/master/SKILL.md

Key rules extracted from ethskills that apply to this project:

- **Say "onchain" not "on-chain"** — one word, Ethereum community convention
- **Use Foundry** — default toolchain for new projects in 2026 (not Hardhat)
- **Use UUPS proxies, not Transparent** — never change storage layout on upgrade
- **Always SafeERC20** — USDT doesn't return bool on transfer()
- **USDC has 6 decimals, not 18** — #1 source of lost funds bugs
- **Never use DEX spot price as oracle** — flash loans can manipulate in one tx; use TWAP or Chainlink
- **Events are the primary way to read historical onchain activity** — design contracts event-first
- **Most dApps need 0–2 contracts, not 5–10** — Solidity is for ownership, transfers, commitments; not a database or backend
- **EIP-7702 is live (May 2025)** — EOAs now have smart contract superpowers; relevant to our AA approach
- **Gas is cheap**: mainnet transfer ~$0.004, swap ~$0.04 at 0.1 gwei — "Ethereum is expensive" is a 2021 myth
- **Never commit private keys or secrets to Git** — bots exploit in seconds
- **For every state transition: who calls it? Why would they? What if nobody does?**

**Per-task skill fetches:** When building, always fetch the relevant ethskills modules:
- Writing Solidity → `standards/`, `security/`, `building-blocks/`, `addresses/`
- Testing → `testing/`
- Deploying → `wallets/`, `gas/`, `frontend-playbook/`
- Indexing/events → `indexing/`
- Auditing existing code → `audit/`

---

## 2. Company Context & Long-Term Vision

### Who We Are
We are a **Web2 fintech** with an existing, high-volume cash voucher business (operating under the iMali/Flash brand). We process massive volumes of voucher and VAS transactions — this is our core operational DNA and the asset we are bringing onchain. Our parent company is launching a **traditional bank (Plus Bank)** — expected release next year.

### The Big Picture
**1Remit is Phase 1 of a neobank.** Every architecture decision must be made with this in mind. The remittance product is the beachhead — it proves the onchain infrastructure and acquires the initial user base. The long-term ambition is a full neobank / payments platform built on the same contract foundation.

**The strategic insight driving design:**
Our cash vouchers are a closed-loop float — customers give us ZAR, we hold it, release value only when needed. The TreasuryToken is the onchain equivalent: we hold deposits as TTZA for as long as possible, converting to external stablecoins or fiat only at exit (remittance payout, merchant settlement, off-ramp). This maximises float, minimises FX exposure, keeps value inside our ecosystem.

### Phase Roadmap
```
Phase 1 — NOW:       1Remit remittance (ZA→ZW corridor, pilot 500 users)
Phase 2 — NEAR:      Wallet + payments (P2P, VAS in TTZA, merchant acceptance)
Phase 3 — MEDIUM:    Neobank (save wallet, yield on float, family banking, credit scoring)
Phase 4 — PLUS BANK: Bridge to Plus Bank — wallets become bank accounts,
                      TreasuryToken becomes regulated e-money, full SARB compliance
```

---

## 3. What We Are Building Now (Phase 1)

**1Remit** is a mobile-first remittance platform targeting the ZA→ZW corridor (pilot), expanding post-pilot.

**Core user flow:**
1. SA consumer deposits ZAR (bank transfer or voucher)
2. Backend mints TTZA (TreasuryToken ZA) and credits Vault balance
3. Consumer initiates remittance via mobile app
4. Backend locks user, calls remittance partner API (Mukuru, WorldRemit etc.)
5. Partner confirms payout in Zimbabwe
6. Backend settles onchain: burns TTZA, deducts Vault balance, records compliance log
7. Consumer receives ZWL (or cash) on the Zimbabwe side

**Design philosophy:**
- Smart contracts are the compliance ledger and settlement layer — not the UX
- Backend (Node.js + Postgres) orchestrates all multi-step flows
- Contracts are minimal, gas-efficient, upgradeable (UUPS)
- POC mode (adminCredit/adminDebit) → Production mode (real ERC20 deposits) — same contracts
- ISO 20022 alignment: events and structs map to standard payment message families
- Every decision evaluated against the neobank roadmap — don't build dead ends
- **Target chain: Tempo** (Stripe/Paradigm EVM settlement layer — EVM-compatible, Reth, Commonware consensus, stablecoin-native gas, ISO 20022-aligned memos)

---

## 4. Source System: Cairo Contracts (iMali on Starknet)

**This EVM build is a port of proven Cairo contracts.** The Cairo system (iMali) runs on Starknet and is the production reference. When designing EVM contracts, use the Cairo logic as the specification — don't reinvent, port faithfully and note any EVM-specific adaptations.

### Cairo Contract Inventory → EVM Mapping

| Cairo contract | Purpose | EVM equivalent |
|---|---|---|
| `ftt.cairo` | Treasury token (TTZA etc.) — permissioned ERC20, blacklist, whitelist, mint/burn | `TreasuryToken.sol` ✅ built |
| `vault.cairo` | Unified balance ledger, deposit/withdraw, transfer_from | `Vault.sol` ✅ built |
| `consumer.cairo` | Identity registry, KYC, wallet factory, compliance log | `Consumer.sol` ✅ built |
| `shared.cairo` | Data types, constants, transaction types | `DataTypes.sol` ✅ built |
| `merchant.cairo` | Merchant registry, self-registration, verification tiers, pubkey registry, consumer-merchant linking | `Merchant.sol` 🔴 NOT BUILT |
| `settlement.cairo` | Payment router — `pay()`, `pay_p2p()`, `pay_external()`, fee engine, batch payments | `Settlement.sol` 🔴 NOT BUILT |
| `sale.cairo` | Transaction history ledger — all tx types, SKU/basket references, pagination | `Sale.sol` 🔴 NOT BUILT |
| `fulfil.cairo` | Zero-trust delivery — encrypted fulfilment NFT, merchant pubkey decryption | `Fulfil.sol` 🟡 PHASE 2 |
| `family.cairo` | Family banking — shared vault, parent/child wallets, spend limits, approval flows | `Family.sol` 🟡 PHASE 3 |
| `escrow.cairo` | Receive-and-forward escrow for external deposits | Not needed — Vault handles this |
| `lookup.cairo` | Country/currency registry | `Lookup.sol` 🟡 PHASE 2 |
| `paymaster.cairo` | Gas abstraction | Handled by Pimlico (off-chain) |
| `query.cairo` | Off-chain-friendly read aggregator | Subgraph / The Graph 🟡 PHASE 3 |
| `account.cairo` | Custom AA account | Safe v1.4.1 + ERC-4337 ✅ via Consumer |

---

## 5. Architecture Overview (EVM)

```
Consumer.sol      — Identity registry, Safe wallet factory, KYC, compliance log
Vault.sol         — Unified balance ledger, remittance flow, P2P transfers, FX swap
TreasuryToken.sol — Permissioned ERC20 per country (TTZA, TTZW etc.), 2 decimals
Merchant.sol      — Merchant registry, verification, consumer-merchant linking [TO BUILD]
Settlement.sol    — Payment router: merchant pay, P2P, external, batch, fee engine [TO BUILD]
Sale.sol          — Transaction history: all tx types, SKU refs, pagination [TO BUILD]
DataTypes.sol     — Shared structs, KYC limits, TX type constants
ISO20022Codes.sol — Purpose codes, status codes, currency constants [TO BUILD]
interfaces/       — IConsumer, ITreasuryToken, IVault, IMerchant, ISale, ISwapRouterV3
```

### Key Design Decisions
- One TreasuryToken per country — closed loop, not publicly tradeable
- 2 decimal places = cent precision (ZAR, ZWL)
- Vault holds `MINTER_ROLE` on TreasuryToken — burns on settlement/FX swap
- Safe v1.4.1 smart wallets per consumer — passkey (WebAuthn) owner, threshold 1
- ERC-4337 via Pimlico paymaster — gasless UX
- `unifiedBalance` is the source of truth — tokens are evidence, not the ledger
- `remittanceLocked` mutex prevents concurrent remittances per user
- Merchant payments bypass the consumer P2P country-match restriction
- Fees collected in TreasuryToken (TTZA), not external stablecoins — keeps float inside ecosystem
- KYC levels 0–3 with daily/monthly spend limits in Consumer
- Pilot cap: 500 consumers, ZW destination only — admin-expandable

### Neobank Accommodation (design now, build later)
- **Safe smart wallets** become the neobank wallet; `spendWallet` + `saveWallet` already in `ConsumerData`
- **`unifiedBalance` multi-currency** naturally extends to savings, merchant float, loan disbursements
- **TreasuryToken closed-loop float** → same mechanism for remittance, merchant payments, regulated e-money under Plus Bank
- **`SETTLEMENT_ROLE` reassignable** → Phase 1: backend. Phase 2+: Settlement.sol contract
- **ISO 20022 alignment** → entire tx history importable by Plus Bank core banking without translation layer

---

## 6. Merchant & Settlement Logic (from Cairo)

### Merchant.sol (port of merchant.cairo)

**Merchant struct** (from shared.cairo):
```
merchant_address, name, country_code, currency_code,
email, website, logo_url, image_id,
verification_status (0=pending, 1=L1, 2=L2, 3=L3, 10=rejected),
is_active, primary1_color, primary2_color (branding)
```

**MerchantConsumer struct** (consumer-merchant link):
```
merchant_address, consumer_address, source_id (merchant's internal customer ID),
display_name_hash, ens_subdomain, biometric_id, source_balance, joined_at
```

**Key functions to port:**
- `registerMerchant(name, countryCode, currencyCode)` — self-registration; validates country via Lookup
- `registerMerchantByOwner(...)` — admin registration for known partners (MTN, Shop2Shop etc.)
- `updateMerchantProfile(...)` — admin updates name/country/currency
- `registerPubkey(pubkey)` — merchant registers ECIES public key for encrypted delivery (Fulfil)
- `setMerchantColors(primary1, primary2)` — branding for in-app merchant UI
- `linkConsumerToMerchant(merchant, consumer, sourceId, ensSubdomain)` — links iMali consumer to merchant's customer ID
- Paginated getters: `getMerchantConsumers(merchant, offset, limit)`, `getConsumerBySourceId`

**EVM-specific adaptations:**
- Replace `replace_class_syscall` upgrade with UUPS `_authorizeUpgrade`
- Replace owner-only pattern with `AccessControl` roles (`MERCHANT_ADMIN_ROLE`, `REGISTRAR_ROLE`)
- Auto-index hook to Subgraph replaces `query_contract.add_merchant_to_index` call

**Pre-seeded merchants** (from Cairo constructor — port these to an `initialize` or migration script):
- Shop2Shop, MTN, Flash Consumer, Flash Trader, Amazon, FNB, Thyme Bank, Hollywood Bets

---

### Settlement.sol (port of settlement.cairo)

**The payment brain** — users never need to know which token they hold; merchants receive one token.

**Core payment flow (from Cairo `pay()`):**
1. Verify merchant exists and is active
2. Resolve currency → base currency via Lookup (e.g. ZARU stablecoin → ZAR base)
3. Check payer has sufficient `unifiedBalance` in Vault
4. Apply platform fee (`fee_bps`, default 10 = 0.10%)
5. Transfer net amount: payer → merchant via Vault
6. Transfer fee: payer → fee_recipient (in TTZA, not stablecoin — keeps float inside ecosystem)
7. Record transaction in Sale contract (tx_hash, gross/net/fee, SKUs, basket_id, note)
8. Emit `PaymentExecuted` event

**Functions to port:**
```
pay(merchant, amount, currency, note, productSkus[], basketId)     → merchant payment
payP2P(to, amount, currency, note)                                 → P2P transfer
payExternal(recipient, amount, currency, token, note)              → send to non-ecosystem address
receiveExternal(recipient, token, amount, note)                    → receive from external wallet
payBatch(payments[], currency)                                     → batch (payroll, refunds)
```

**Transaction types** (from shared.cairo constants — port to DataTypes.sol):
```solidity
uint8 constant TX_TYPE_MERCHANT_PAYMENT  = 0;
uint8 constant TX_TYPE_P2P               = 1;
uint8 constant TX_TYPE_DEPOSIT           = 2;
uint8 constant TX_TYPE_WITHDRAW          = 3;
uint8 constant TX_TYPE_REFUND            = 4;
uint8 constant TX_TYPE_EXTERNAL          = 5;  // pay_external
uint8 constant TX_TYPE_INTERNAL_TRANSFER = 8;  // wallet-to-wallet
```

**Fee design decision:** Fees are collected in TTZA (TreasuryToken), not stablecoins. This keeps float inside the ecosystem — same principle as our voucher business.

**EVM-specific adaptations:**
- Replace `tx_info.transaction_hash` (Starknet) with `keccak256(abi.encodePacked(block.number, msg.sender, nonce))` as transaction ID
- `payBatch` stub exists in Cairo — implement as gas-efficient loop in EVM with single event
- Currency resolution (stablecoin → base) handled via Lookup contract or mapping in Vault

---

### Sale.sol (port of sale.cairo)

**Transaction history ledger** — records every payment, P2P, deposit, withdrawal.

**Transaction struct** (from shared.cairo):
```
transaction_id, tx_hash, from, to,
gross_amount, net_amount, fee_amount,
currency, transaction_type, status,
timestamp, merchant_address, note, basket_id, items_count
```

**Key functions:**
- `recordTransaction(...)` — called by Settlement and Vault; stores tx + indexes by from/to/merchant
- `recordInternalTransfer(...)` — called by backend/authorized_recorder for wallet-to-wallet
- `getTransaction(id)` → full Transaction struct
- `getTransactionSkus(id)` → array of SKU IDs
- `getConsumerTransactions(consumer, limit, offset)` → paginated tx IDs
- `getMerchantTransactions(merchant, limit, offset)` → paginated tx IDs

**Access control:** Only Settlement and Vault can call `recordTransaction`. Separate `authorized_recorder` address for internal transfers (backend signer).

**EVM note:** `felt252` transaction IDs in Cairo become `bytes32` in Solidity. SKU IDs are `bytes32`.

---

## 7. TreasuryToken Strategy

### The Float Model
TTZA (and future TTZW, TTMZ etc.) are internal float tokens, not public stablecoins:

```
Customer deposits ZAR (cash / bank / voucher)
    → Backend mints TTZA (1:1, held in Vault)
    → Balance is TTZA until exit event
    → Exit events: remittance payout, merchant settlement, off-ramp, FX swap
    → Only at exit: convert to external value (USDC, fiat, partner payout)
```

Benefits: float retention, minimal FX exposure, last-moment conversion, self-contained ecosystem.

### VAS Settlement in TTZA
Consumer pays TTZA for airtime/electricity/data → Vault debits consumer, credits VAS provider → VAS provider holds TTZA float → settles to ZAR at agreed intervals.

### Merchant Integration (Shop2Shop and beyond)
Merchants accept TTZA as payment. Key unresolved: settlement cadence (batch vs on-demand), merchant KYC tiers, Shop2Shop gas efficiency (high volume, low value → evaluate batch settlement).

---

## 8. Plus Bank Integration (Phase 4)

Plus Bank launches ~next year as a SARB-licensed bank. Design now for compatibility:
- TreasuryToken UUPS-upgradeable → can become regulated e-money ✅
- `globalConsumerId` → becomes Plus Bank customer number
- Onchain tx history → importable to core banking via ISO 20022 (camt format)
- KYC levels extensible (currently 0–3, may need 0–5 for SARB AML)
- Compliance log → exportable in ISO 20022 `camt` format for SARB reporting

**Design principle:** Build as if Plus Bank will one day issue TreasuryToken under its banking licence.

---

## 9. ISO 20022 Alignment

**Agreed approach:**
- UETR (Unique End-to-End Transaction Reference) = universal key linking all onchain events to off-chain ISO 20022 messages and Postgres records
- UETR: UUID v4 generated by backend, passed as `bytes32`
- Full ISO 20022 XML payload stored off-chain (IPFS) — only content hash onchain
- Tempo memo field carries UETR + purposeCode → bridges onchain events to TradFi messaging world

| Event | ISO 20022 equivalent |
|---|---|
| `RemittanceStarted` | `pain.001` — payment initiation |
| `RemittanceSettled` | `pacs.008` + `pacs.002` status |
| `RemittanceRecorded` | `camt.054` — debit/credit notification |
| `PaymentExecuted` (merchant) | `pacs.008` — credit transfer |
| `P2PPaymentExecuted` | `pacs.008` — domestic credit transfer |
| `UsdPurchased` | `fxtr.014` — FX trade |
| Future merchant batch settlement | `pain.001` / `pacs.003` direct debit |

**Purpose codes to add (ISO20022Codes.sol):**
`REMT`, `FAMI`, `SALA`, `SUPP`, `CGDD` (goods/services), `VATX` (VAS/tax)

---

## 10. Current Build State

### Consumer.sol ✅
- Safe wallet factory, consumer registration (ENS hash, name hash, country, KYC level)
- KYC management, spend limit checking (daily/monthly buckets)
- Compliance remittance log (append-only), `recordRemittance()`
- Roles: `REGISTRAR_ROLE`, `KYC_UPDATER_ROLE`, `RECORDER_ROLE`
- Events: `ConsumerRegistered`, `KycLevelUpdated`, `RemittanceRecorded` ⚠️ missing UETR

### Vault.sol ✅
- `adminCredit`/`adminDebit` (POC), `credit` (SETTLEMENT_ROLE)
- `transfer` (P2P with country-match), `startRemittance`, `payRemittance`
- `depositFromExternal`/`withdrawToExternal`, `purchaseUsd` (Uniswap V3)
- Token registry, allowed destination registry
- Events: `RemittanceStarted` ⚠️, `RemittanceSettled` ⚠️, `UsdPurchased` ⚠️ — all missing UETR

### TreasuryToken.sol ✅
- ERC20Upgradeable, 2 decimals, mint/burn/burnOwn
- Blacklist (always active) + whitelist (toggle), pause/unpause

### DataTypes.sol ✅ (not yet uploaded — assumed complete)
- `ConsumerData`, `RemittanceRecord` structs; KYC limit constants

### Merchant.sol 🔴 NOT BUILT
### Settlement.sol 🔴 NOT BUILT
### Sale.sol 🔴 NOT BUILT
### ISO20022Codes.sol 🔴 NOT BUILT

---

## 11. Build Backlog

### 🔴 Priority 1 — Complete the core payment stack

#### A. Add UETR + purposeCode to remittance flow
**Files:** `Vault.sol`, `Consumer.sol`, `DataTypes.sol`
```
Vault: + mapping(address => bytes32) pendingUetr
startRemittance(user, uetr, amount, currencyCode) — store uetr, emit with uetr+amount+currency
payRemittance(from, amount, currencyCode, destinationCountryCode, purposeCode) — clear uetr, emit with uetr+purposeCode
DataTypes: RemittanceRecord += bytes32 uetr, bytes4 purposeCode
Consumer: RemittanceRecorded event += bytes32 indexed uetr
```

#### B. ISO20022Codes.sol — constants library
Purpose codes: `REMT`, `FAMI`, `SALA`, `SUPP`, `CGDD`, `VATX`
Status codes: `ACCP`, `RJCT`, `PDNG`
Currency constants: `CCY_ZAR`, `CCY_ZWL`, `CCY_USD`

#### C. Add UETR + exchangeRate to UsdPurchased event
`UsdPurchased(buyer, uetr, localAmount, localCurrency, usdcReceived, exchangeRateScaled)`
Exchange rate = `usdcReceived * 1e6 / localAmount` (scaled integer)

#### D. Merchant.sol — port from merchant.cairo
See Section 6 for full spec. Key decisions:
- `AccessControl` roles: `DEFAULT_ADMIN_ROLE`, `MERCHANT_REGISTRAR_ROLE`
- UUPS upgradeable
- Separate from Consumer.sol (merchant KYC/settlement patterns differ materially)
- Pre-seed: Shop2Shop, MTN, Flash Consumer/Trader, Amazon, FNB in `initialize()`

#### E. Sale.sol — port from sale.cairo
See Section 6 for full spec. Key decisions:
- Only Settlement and Vault can call `recordTransaction`
- `authorized_recorder` for backend internal transfer recording
- `bytes32` for transaction IDs and SKU IDs (not felt252)
- Paginated getters for consumer and merchant tx history

#### F. Settlement.sol — port from settlement.cairo
See Section 6 for full spec. Key decisions:
- `pay()`, `payP2P()`, `payExternal()`, `receiveExternal()`, `payBatch()`
- Fee in TTZA (not stablecoin)
- Default fee: 10 bps (0.10%)
- Calls Vault for balance check and transfer, calls Sale for recording
- Country-match bypass for merchant payments (B2C is cross-country)
- Add UETR to all payment events for ISO 20022 alignment

---

### 🟡 Priority 2 — Post-Pilot Prep

#### G. Backend: UETR generation + ISO 20022 payload (Node.js — not started)
- UUID v4 → `bytes32` for contract calls
- Construct `pacs.008` XML per remittance
- Store on IPFS (Pinata/web3.storage), store CID in Postgres
- Emit `keccak256(payload)` onchain as audit anchor

#### H. Settlement contract replaces backend SETTLEMENT_ROLE
- Deploy Settlement.sol, reassign `SETTLEMENT_ROLE` in Vault
- Automates: startRemittance → payRemittance → recordRemittance sequence

#### I. Save wallet creation
- `createSaveWallet(spendWallet)` in Consumer → deploys second Safe
- Foundation for savings/yield product

#### J. Lift country-match for B2C payments
- `transfer` in Vault enforces same-country (correct for P2P)
- Merchant `pay()` via Settlement must bypass this — use `paymentType` flag or separate path

#### K. Uniswap V3 price feed
- Currently `purchaseUsd` uses execution price with caller `minUsdcOut` as slippage guard
- Consider Chainlink or TWAP reference for dispute resolution

---

### 🟢 Priority 3 — Phase 2/3 (Payments, Neobank)

#### L. Fulfil.sol — zero-trust encrypted delivery (port from fulfil.cairo)
- Consumer pays → Fulfilment NFT minted to merchant
- Delivery details encrypted with merchant ECIES pubkey, stored onchain
- Merchant calls `revealDelivery(saleId)` → decrypts off-chain with private key

#### M. Family.sol — family banking (port from family.cairo)
- Parent wallet creates family group (shared Vault balance pool)
- Children have spend wallets with daily limits and approval thresholds
- Parent approves transactions above threshold
- Foundation for Plus Bank family banking product

#### N. Lookup.sol — country/currency registry (port from lookup.cairo)
- Country registry (code, name, currency, VAT rate, dial code, is_active)
- Currency registry with type (FIAT=0, STABLECOIN=1, TREASURY=2)
- Base currency resolution (stablecoin → fiat anchor)
- Used by Merchant and Settlement for currency validation

#### O. Multi-corridor expansion
- New TreasuryToken per country (TTZW, TTMZ etc.)
- Per-corridor KYC limits

#### P. IPFS payload verification onchain
- `verifyPayload(bytes32 uetr, bytes32 claimedCid)` → checks stored CID
- Enables regulatory audit without backend access

#### Q. The Graph subgraph
- Index all UETR-tagged events across Vault, Consumer, Settlement
- Replaces `query.cairo` auto-index pattern
- Foundation for Plus Bank core banking reconciliation import

---

### 🔵 Priority 4 — Phase 3–4 (Plus Bank)

#### R. Plus Bank bridge
- TreasuryToken upgrade path to regulated e-money
- `globalConsumerId` → Plus Bank customer number
- ISO 20022 compliance log export in `camt` format
- KYC extension for SARB AML requirements

#### S. Yield on float
- Backend earns interest on ZAR deposits
- Yield distribution contract credits TTZA holders periodically
- Foundation for savings product (cf. `YieldIssued` event already in shared.cairo)

#### T. Credit scoring from onchain history
- Remittance + payment history → onchain credit score
- Enables micro-lending under Plus Bank licence

---

## 12. Key External Dependencies

| Dependency | Version | Address / Notes |
|---|---|---|
| Safe singleton | v1.4.1 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` (all EVM) |
| Safe ProxyFactory | v1.4.1 | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` (all EVM) |
| OpenZeppelin Contracts | v5.x | npm — use upgradeable variants |
| Uniswap V3 SwapRouter02 | — | network-specific (verify via ethskills addresses/) |
| Pimlico paymaster | — | configured off-chain post-consumer registration |
| Tempo (target chain) | EVM/Reth | Stripe/Paradigm — not yet publicly live |
| Plus Bank | — | Parent company traditional bank, launching ~next year |
| Shop2Shop | — | Priority merchant integration partner, Phase 2 |
| MTN | — | VAS provider, pre-seeded in Merchant |
| Chainlink | — | Future price oracle for `purchaseUsd` dispute resolution |
