// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy}     from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {TreasuryToken} from "../src/TreasuryToken.sol";
import {Vault}         from "../src/Vault.sol";
import {Consumer}      from "../src/Consumer.sol";

/// @title Deploy
/// @notice Deploys and wires all 1Remit contracts in a single broadcast.
///
///         Run on Sepolia:
///           forge script script/Deploy.s.sol \
///             --rpc-url $RPC_URL_SEPOLIA \
///             --broadcast \
///             --verify \
///             --etherscan-api-key $ETHERSCAN_API_KEY
///
///         All config is read from .env -- never hardcode secrets.
///         Copy .env.example -> .env and fill every variable before running.
contract Deploy is Script {
    // ── Deterministic protocol addresses (CREATE2 -- same on all EVM chains) ──
    // Safe v1.4.1 -- verified via eth_getCode on Mainnet + Sepolia
    address constant SAFE_SINGLETON_141     = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address constant SAFE_PROXY_FACTORY_141 = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;

    // ── Deployed addresses (state avoids stack-too-deep in run()) ─────────────
    address internal ttzaImpl;
    address internal ttza;
    address internal ttzwImpl;
    address internal ttzw;
    address internal vaultImpl;
    address internal vault;
    address internal consumerImpl;
    address internal consumer;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        _deployTokens();
        _deployVault();
        _deployConsumer();
        _wireContracts();
        vm.stopBroadcast();

        _writeManifest();
        _logSummary();
    }

    // ── Deploy TreasuryToken proxies ──────────────────────────────────────────

    function _deployTokens() internal {
        address admin         = vm.envAddress("ADMIN_ADDRESS");
        uint256 initialSupply = vm.envUint("INITIAL_SUPPLY");

        ttzaImpl = address(new TreasuryToken());
        ttza = address(new ERC1967Proxy(
            ttzaImpl,
            abi.encodeCall(TreasuryToken.initialize, ("1Remit ZA Token", "TTZA", admin, initialSupply))
        ));

        ttzwImpl = address(new TreasuryToken());
        ttzw = address(new ERC1967Proxy(
            ttzwImpl,
            abi.encodeCall(TreasuryToken.initialize, ("1Remit ZW Token", "TTZW", admin, initialSupply))
        ));
    }

    // ── Deploy Vault proxy ────────────────────────────────────────────────────

    function _deployVault() internal {
        address admin      = vm.envAddress("ADMIN_ADDRESS");
        address swapRouter = vm.envAddress("SWAP_ROUTER_ADDRESS");
        address usdc       = vm.envAddress("USDC_ADDRESS");

        vaultImpl = address(new Vault());
        vault = address(new ERC1967Proxy(
            vaultImpl,
            abi.encodeCall(Vault.initialize, (admin, swapRouter, usdc))
        ));
    }

    // ── Deploy Consumer proxy ─────────────────────────────────────────────────

    function _deployConsumer() internal {
        address admin           = vm.envAddress("ADMIN_ADDRESS");
        address fallbackHandler = vm.envAddress("SAFE_FALLBACK_HANDLER");

        consumerImpl = address(new Consumer());
        consumer = address(new ERC1967Proxy(
            consumerImpl,
            abi.encodeCall(Consumer.initialize, (
                admin,
                SAFE_SINGLETON_141,
                SAFE_PROXY_FACTORY_141,
                fallbackHandler
            ))
        ));
    }

    // ── Post-deploy wiring ────────────────────────────────────────────────────

    function _wireContracts() internal {
        address backend = vm.envAddress("BACKEND_SIGNER_ADDRESS");
        address usdc    = vm.envAddress("USDC_ADDRESS");
        address zarP    = vm.envAddress("ZARP_TOKEN_ADDRESS");
        address zarU    = vm.envAddress("ZARU_TOKEN_ADDRESS");

        Vault    v = Vault(vault);
        Consumer c = Consumer(consumer);
        TreasuryToken za = TreasuryToken(ttza);
        TreasuryToken zw = TreasuryToken(ttzw);

        // Register backing tokens
        // USDC uses keccak256("USDC") to match Vault.USDC_CODE constant
        v.addToken(zarP, keccak256("ZAR"));
        v.addToken(zarU, keccak256("ZAR"));
        v.addToken(usdc, keccak256("USDC"));

        // Backend: ADMIN_EXECUTOR_ROLE on Vault (admin already has it from initialize)
        v.grantRole(v.ADMIN_EXECUTOR_ROLE(), backend);

        // Wire Consumer for KYC / country-match checks
        v.setConsumerContract(consumer);

        // TreasuryTokens per currency
        v.setCurrencyTreasuryToken(keccak256("ZAR"), ttza);
        v.setCurrencyTreasuryToken(keccak256("ZWL"), ttzw);

        // Vault must hold MINTER_ROLE to call burn() during remittance settlement + USD purchase
        bytes32 minterRole = za.MINTER_ROLE();
        za.grantRole(minterRole, vault);
        zw.grantRole(minterRole, vault);

        // Backend needs MINTER_ROLE to mint on fiat deposit confirmation
        za.grantRole(minterRole, backend);
        zw.grantRole(minterRole, backend);

        // Consumer roles for backend
        c.grantRole(c.REGISTRAR_ROLE(),   backend);
        c.grantRole(c.KYC_UPDATER_ROLE(), backend);
        c.grantRole(c.RECORDER_ROLE(),    backend);
    }

    // ── Write deployments/{chainId}.json ─────────────────────────────────────

    function _writeManifest() internal {
        vm.createDir("deployments", true);

        string memory obj = "deployment";
        vm.serializeAddress(obj, "ttzaImpl",     ttzaImpl);
        vm.serializeAddress(obj, "ttza",         ttza);
        vm.serializeAddress(obj, "ttzwImpl",     ttzwImpl);
        vm.serializeAddress(obj, "ttzw",         ttzw);
        vm.serializeAddress(obj, "vaultImpl",    vaultImpl);
        vm.serializeAddress(obj, "vault",        vault);
        vm.serializeAddress(obj, "consumerImpl", consumerImpl);
        string memory json = vm.serializeAddress(obj, "consumer", consumer);

        string memory outPath = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, outPath);
        console2.log("Manifest:", outPath);
    }

    // ── Console summary ───────────────────────────────────────────────────────

    function _logSummary() internal view {
        console2.log("=== 1Remit Deployment chain", block.chainid, "===");
        console2.log("TTZA  impl   :", ttzaImpl);
        console2.log("TTZA  proxy  :", ttza);
        console2.log("TTZW  impl   :", ttzwImpl);
        console2.log("TTZW  proxy  :", ttzw);
        console2.log("Vault impl   :", vaultImpl);
        console2.log("Vault proxy  :", vault);
        console2.log("Consumer impl:", consumerImpl);
        console2.log("Consumer proxy:", consumer);
        console2.log("");
        console2.log("Post-deploy checklist:");
        console2.log("  1. Whitelist Consumer proxy in Pimlico paymaster (pm_sponsorUserOperation)");
        console2.log("  2. Set CONSUMER_ADDRESS in backend config");
        console2.log("  3. Fund backend wallet with ETH for gas");
    }
}
