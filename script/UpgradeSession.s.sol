// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Consumer} from "../src/Consumer.sol";
import {SessionTransferModule} from "../src/SessionTransferModule.sol";

/// @title UpgradeSession
/// @notice Deploys SessionTransferModule, upgrades Consumer to the current impl
///         (sessionTransferModule storage + deploy wiring), and registers the module
///         on the Consumer registry so NEW Safes enable it at setup.
///
///         Existing consumer Safes still need a one-time enableModule SafeTx
///         (handled by the session/start API when the module is not yet enabled).
///
///   CONSUMER_CONTRACT_ADDRESS=0x… VAULT_CONTRACT_ADDRESS=0x… \
///     forge script script/UpgradeSession.s.sol \
///     --rpc-url $RPC_URL_SEPOLIA --broadcast
contract UpgradeSession is Script {
    function run() external {
        uint256 ownerKey      = vm.envUint("DEPLOYER_ADMIN_PRIVATE_KEY");
        address consumerProxy = vm.envAddress("CONSUMER_CONTRACT_ADDRESS");
        address vault         = vm.envAddress("VAULT_CONTRACT_ADDRESS");

        vm.startBroadcast(ownerKey);

        address sessionModule = address(new SessionTransferModule(vault));
        address newImpl       = address(new Consumer());
        Consumer proxy        = Consumer(consumerProxy);

        proxy.upgradeToAndCall(newImpl, "");
        proxy.setSessionTransferModule(sessionModule);

        vm.stopBroadcast();

        require(proxy.sessionTransferModule() == sessionModule, "module not set");

        console2.log("=== Session module upgrade complete (chain", block.chainid, ") ===");
        console2.log("Consumer proxy       :", consumerProxy);
        console2.log("Consumer impl        :", newImpl);
        console2.log("VERSION              :", proxy.VERSION());
        console2.log("SessionTransferModule:", sessionModule);
        console2.log("Vault                :", vault);
    }
}
