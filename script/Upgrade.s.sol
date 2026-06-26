// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {TreasuryToken} from "../src/TreasuryToken.sol";
import {Vault}         from "../src/Vault.sol";
import {Consumer}      from "../src/Consumer.sol";

/// @title Upgrade
/// @notice Upgrades the existing v1.0.0 UUPS proxies (Consumer, Vault, TTZA) to the
///         current implementations, then applies the post-upgrade wiring that
///         initialize() cannot (it only runs once on a fresh proxy).
///
///         Broadcast from the owner wallet (DEPLOYER_ADMIN_ADDRESS), which holds
///         DEFAULT_ADMIN_ROLE on all three proxies (authorises _authorizeUpgrade).
///
///           forge script script/Upgrade.s.sol \
///             --rpc-url $RPC_URL_SEPOLIA --broadcast
///
///         ZA-only: TTZW is not deployed. All addresses are preserved.
contract Upgrade is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("DEPLOYER_ADMIN_PRIVATE_KEY");
        address owner    = vm.envAddress("DEPLOYER_ADMIN_ADDRESS");
        address backend  = vm.envAddress("BACKEND_SIGNER_ADDRESS");

        address consumerProxy = vm.envAddress("CONSUMER_CONTRACT_ADDRESS");
        address vaultProxy    = vm.envAddress("VAULT_CONTRACT_ADDRESS");
        address ttzaProxy     = vm.envAddress("TREASURY_TOKEN_ZA_ADDRESS");

        vm.startBroadcast(ownerKey);

        // 1. Deploy the new implementations.
        address consumerImpl = address(new Consumer());
        address vaultImpl    = address(new Vault());
        address ttzaImpl     = address(new TreasuryToken());

        // 2. Point each proxy at its new implementation (no reinit data).
        Consumer(consumerProxy).upgradeToAndCall(consumerImpl, "");
        Vault(vaultProxy).upgradeToAndCall(vaultImpl, "");
        TreasuryToken(ttzaProxy).upgradeToAndCall(ttzaImpl, "");

        // 3. Post-upgrade wiring — state initialize() won't set on an existing proxy.

        // Vault: mark the platform treasury (owner) a trusted counterparty so it can
        // send/receive USDC & unified balances. (consumerContract + backend's
        // ADMIN_EXECUTOR_ROLE were already set at the original deploy.)
        Vault(vaultProxy).setTrustedCounterparty(owner, true);

        // TreasuryToken (TTZA): grant the new COMPLIANCE_ROLE, wire the Consumer
        // registry, enable the compliance gate, and trust the platform treasury.
        TreasuryToken za = TreasuryToken(ttzaProxy);
        za.grantRole(za.COMPLIANCE_ROLE(), owner);   // so this script may whitelist
        za.grantRole(za.COMPLIANCE_ROLE(), backend); // backend whitelists merchants
        za.setConsumerContract(consumerProxy);
        za.setComplianceEnabled(true);
        za.addToWhitelist(owner);                    // platform treasury = trusted

        vm.stopBroadcast();

        console2.log("=== Upgrade complete (chain", block.chainid, ") ===");
        console2.log("Consumer proxy:", consumerProxy, "-> impl", consumerImpl);
        console2.log("Vault    proxy:", vaultProxy,    "-> impl", vaultImpl);
        console2.log("TTZA     proxy:", ttzaProxy,     "-> impl", ttzaImpl);
    }
}
