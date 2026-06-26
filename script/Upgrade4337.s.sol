// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Consumer}        from "../src/Consumer.sol";

/// @title Upgrade4337
/// @notice Upgrades the Consumer UUPS proxy to v1.1.0 (4337-capable Safe setup)
///         and configures the Safe4337Module + SafeModuleSetup so that NEWLY
///         registered Safes become ERC-4337 accounts. Existing Safes are untouched.
///         Backward-compatible: until setSafe4337Config runs, deployment is the
///         plain 1.4.1 setup; this script sets it in the same broadcast.
///
///         Broadcast from the owner wallet (DEPLOYER_ADMIN_ADDRESS), which holds
///         DEFAULT_ADMIN_ROLE on the Consumer proxy.
///
///           CONSUMER_CONTRACT_ADDRESS=0x… forge script script/Upgrade4337.s.sol \
///             --rpc-url $RPC_URL_SEPOLIA --broadcast
///
///         Defaults to the canonical Safe v0.3.0 module addresses (EntryPoint v0.7),
///         overridable via SAFE_4337_MODULE_ADDRESS / SAFE_MODULE_SETUP_ADDRESS.
contract Upgrade4337 is Script {
    // Safe modules v0.3.0 (verified deployed on Sepolia).
    address constant DEFAULT_4337_MODULE  = 0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226;
    address constant DEFAULT_MODULE_SETUP = 0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47;

    function run() external {
        uint256 ownerKey      = vm.envUint("DEPLOYER_ADMIN_PRIVATE_KEY");
        address consumerProxy = vm.envAddress("CONSUMER_CONTRACT_ADDRESS");
        address module        = vm.envOr("SAFE_4337_MODULE_ADDRESS", DEFAULT_4337_MODULE);
        address moduleSetup   = vm.envOr("SAFE_MODULE_SETUP_ADDRESS", DEFAULT_MODULE_SETUP);

        require(module.code.length > 0,      "Safe4337Module has no code on this chain");
        require(moduleSetup.code.length > 0, "SafeModuleSetup has no code on this chain");

        vm.startBroadcast(ownerKey);

        address newImpl = address(new Consumer());
        Consumer proxy  = Consumer(consumerProxy);
        proxy.upgradeToAndCall(newImpl, "");
        proxy.setSafe4337Config(module, moduleSetup);

        vm.stopBroadcast();

        // Post-conditions (read-only).
        require(proxy.safe4337Module() == module,       "module not set");
        require(proxy.safeModuleSetup() == moduleSetup, "moduleSetup not set");

        console2.log("=== Consumer 4337 upgrade complete (chain", block.chainid, ") ===");
        console2.log("Consumer proxy :", consumerProxy);
        console2.log("New impl       :", newImpl);
        console2.log("VERSION        :", proxy.VERSION());
        console2.log("safe4337Module :", proxy.safe4337Module());
        console2.log("safeModuleSetup:", proxy.safeModuleSetup());
    }
}
