// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy}     from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {TreasuryToken} from "../src/TreasuryToken.sol";
import {Vault}         from "../src/Vault.sol";
import {Consumer}      from "../src/Consumer.sol";
import {SessionTransferModule} from "../src/SessionTransferModule.sol";

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
    address internal sessionModule;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_ADMIN_PRIVATE_KEY");

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
        address admin         = vm.envAddress("DEPLOYER_ADMIN_ADDRESS");
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
        address admin      = vm.envAddress("DEPLOYER_ADMIN_ADDRESS");
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
        address admin           = vm.envAddress("DEPLOYER_ADMIN_ADDRESS");
        address fallbackHandler = vm.envAddress("SAFE_FALLBACK_HANDLER_ADDRESS");

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

        // Make new consumer Safes ERC-4337 accounts (Safe4337Module enabled at
        // setup). Defaults to the canonical Safe v0.3.0 modules (EntryPoint v0.7);
        // override via env, or pass address(0) to keep the plain 1.4.1 setup.
        address module4337  = vm.envOr("SAFE_4337_MODULE_ADDRESS", address(0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226));
        address moduleSetup = vm.envOr("SAFE_MODULE_SETUP_ADDRESS", address(0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47));
        if (module4337 != address(0) && moduleSetup != address(0)) {
            Consumer(consumer).setSafe4337Config(module4337, moduleSetup);
        }
    }

    // ── Post-deploy wiring ────────────────────────────────────────────────────

    function _wireContracts() internal {
        address admin   = vm.envAddress("DEPLOYER_ADMIN_ADDRESS");
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

        // Platform treasury is a trusted Vault counterparty (can send/receive USDC
        // and unified balances without being a registered consumer). Merchants are
        // added by the backend at onboarding. Deployer holds ADMIN_EXECUTOR_ROLE.
        v.setTrustedCounterparty(admin, true);

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

        // ── TreasuryToken compliance gate (v1.1.0) ────────────────────────────
        // COMPLIANCE_ROLE = compliance operator: freeze / forcedTransfer (clawback,
        // lost-passkey recovery) AND merchant-whitelist management at onboarding.
        // Granted to backend for automated ops; consider moving to a Safe later.
        // (Not to be confused with a "cash-out agent", which is a merchant type.)
        bytes32 complianceRole = za.COMPLIANCE_ROLE();
        za.grantRole(complianceRole, backend);
        zw.grantRole(complianceRole, backend);

        // Point each TT at the Consumer registry and turn the gate ON so transfers
        // are restricted to: registered consumers (same-country, no KYC needed) and
        // whitelisted trusted addresses (platform treasury + merchants).
        za.setConsumerContract(consumer);
        zw.setConsumerContract(consumer);
        za.setComplianceEnabled(true);
        zw.setComplianceEnabled(true);

        // Whitelist the platform treasury (holds INITIAL_SUPPLY and settles merchant
        // payouts) as a trusted, country-agnostic settlement address on both tokens.
        // Merchant wallets are whitelisted by the backend (COMPLIANCE_ROLE) at onboarding.
        za.addToWhitelist(admin);
        zw.addToWhitelist(admin);

        // SessionTransferModule — cheaper per-tx auth when enabled in Admin Settings.
        sessionModule = address(new SessionTransferModule(vault));
        c.setSessionTransferModule(sessionModule);

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
        vm.serializeAddress(obj, "sessionModule", sessionModule);
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
        console2.log("SessionTransferModule:", sessionModule);
        console2.log("");
        console2.log("Post-deploy checklist:");
        console2.log("  1. Whitelist Consumer proxy in Pimlico paymaster (pm_sponsorUserOperation)");
        console2.log("  2. Set CONSUMER_ADDRESS in backend config");
        console2.log("  3. Fund backend wallet with ETH for gas");
        console2.log("  4. Compliance gate is ON: TT transfers limited to consumers +");
        console2.log("     whitelisted platform/merchants; Vault transfers require both KYC'd");
        console2.log("  5. Whitelist each merchant wallet on TTZA/TTZW at onboarding (COMPLIANCE_ROLE)");
        console2.log("  6. Set SESSION_TRANSFER_MODULE_ADDRESS=", sessionModule);
    }
}
