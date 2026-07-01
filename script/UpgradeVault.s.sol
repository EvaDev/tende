// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {Vault} from "../src/Vault.sol";

/// @title UpgradeVault
/// @notice Upgrades ONLY the Vault UUPS proxy to the current implementation
///         (v1.2.0 — P2P transfer gate now accepts any registered consumer,
///         Level 0+). No reinit and no re-wiring: the gate change adds no storage
///         and consumerContract / trustedCounterparty are already set on-chain.
///
///         Broadcast from the owner wallet (DEPLOYER_ADMIN_ADDRESS), which holds
///         DEFAULT_ADMIN_ROLE on the proxy (authorises _authorizeUpgrade):
///
///           forge script script/UpgradeVault.s.sol \
///             --rpc-url $RPC_URL_SEPOLIA --broadcast
contract UpgradeVault is Script {
    function run() external {
        uint256 ownerKey   = vm.envUint("DEPLOYER_ADMIN_PRIVATE_KEY");
        address vaultProxy = vm.envAddress("VAULT_CONTRACT_ADDRESS");

        vm.startBroadcast(ownerKey);

        address vaultImpl = address(new Vault());
        Vault(vaultProxy).upgradeToAndCall(vaultImpl, "");

        vm.stopBroadcast();

        console2.log("=== Vault upgrade complete (chain", block.chainid, ") ===");
        console2.log("Vault proxy:", vaultProxy, "-> impl", vaultImpl);
        console2.log("New VERSION:", Vault(vaultProxy).VERSION());
    }
}
