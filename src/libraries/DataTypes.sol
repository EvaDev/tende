// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library DataTypes {

    // ── Consumer ─────────────────────────────────────────────────────────────
    struct ConsumerData {
        address spendWallet;      // ERC-4337 Safe smart account (spend)
        address saveWallet;       // ZAR save wallet   (optional, zero until created)
        address usdWallet;        // USD savings wallet (optional, zero until created)
        bytes32 displayNameHash;  // keccak256(displayName) — plaintext in idOS only
        bytes32 ensSubdomainHash; // keccak256(subdomain) — ENS registration is offchain
        bytes32 countryCode;      // e.g. keccak256("ZA") — enforced for P2P matching
        uint8   kycLevel;         // 0=none 1=basic 2=enhanced 3=full
        bool    isActive;
        uint256 globalConsumerId; // auto-increment from 1000
    }

    // ── Compliance log (append-only) ─────────────────────────────────────────
    struct RemittanceRecord {
        address sender;
        bytes32 recipientMobileHash;    // keccak256(mobile) — never store plaintext
        bytes32 destinationCountryCode;
        uint256 amountSent;             // treasury token units (2 decimals = cents)
        uint256 timestamp;
        bytes32 partnerId;              // which off-ramp partner fulfilled it
    }

    // ── KYC hard limits (enforced in Consumer) ────────────────────────────────
    // All amounts in token units with 2 decimals (100 = R1.00)
    // Level 0: no remittance, spend only within basic limits
    // Level 1: R5,000/day    R20,000/month
    // Level 2: R10,000/day   R50,000/month
    // Level 3: R25,000/day   R100,000/month
    uint256 constant KYC1_DAILY   = 500_000;    // R5,000.00
    uint256 constant KYC1_MONTHLY = 2_000_000;  // R20,000.00
    uint256 constant KYC2_DAILY   = 1_000_000;  // R10,000.00
    uint256 constant KYC2_MONTHLY = 5_000_000;  // R50,000.00
    uint256 constant KYC3_DAILY   = 2_500_000;  // R25,000.00
    uint256 constant KYC3_MONTHLY = 10_000_000; // R100,000.00

    // ── Transaction type constants ────────────────────────────────────────────
    uint8 constant TX_REMITTANCE   = 0;
    uint8 constant TX_P2P          = 1;
    uint8 constant TX_DEPOSIT      = 2;
    uint8 constant TX_BURN_REMIT   = 3;
    uint8 constant TX_USD_PURCHASE = 4;
}
