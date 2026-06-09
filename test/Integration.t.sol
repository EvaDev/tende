// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}         from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Vault}         from "../src/Vault.sol";
import {Consumer}      from "../src/Consumer.sol";
import {TreasuryToken} from "../src/TreasuryToken.sol";
import {DataTypes}     from "../src/libraries/DataTypes.sol";

import {MockSafeProxyFactory} from "./mocks/MockSafeProxyFactory.sol";
import {MockERC20}            from "./mocks/MockERC20.sol";
import {MockSwapRouter}       from "./mocks/MockSwapRouter.sol";

/// @title Integration
/// @notice Full-stack remittance flow and fork-based USD purchase test.
contract IntegrationTest is Test {
    Vault                internal vault;
    Consumer             internal consumer;
    TreasuryToken        internal ttza;
    MockSafeProxyFactory internal factory;
    MockERC20            internal zarToken;
    MockERC20            internal usdcToken;
    MockSwapRouter       internal swapRouter;

    address internal admin   = makeAddr("admin");
    address internal backend = makeAddr("backend");

    address internal constant SAFE_SINGLETON = address(0xAA);

    bytes32 internal constant ZAR_CODE  = keccak256("ZAR");
    bytes32 internal constant ZWL_CODE  = keccak256("ZWL");
    bytes32 internal constant ZW_CODE   = keccak256("ZW");  // allowed destination
    bytes32 internal constant USDC_CODE = keccak256("USDC");

    // Registered wallets (returned by registerConsumer)
    address internal walletZA;
    address internal walletZW;

    uint256 internal constant REMIT_AMOUNT = 100_000; // 1,000.00 in 2-decimal units

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        vm.warp(1_000_000);

        swapRouter = new MockSwapRouter();
        usdcToken  = new MockERC20("USD Coin", "USDC", 6);
        zarToken   = new MockERC20("ZARP",     "ZARP", 2);
        factory    = new MockSafeProxyFactory();

        // Deploy TTZA
        TreasuryToken ttzaImpl = new TreasuryToken();
        ttza = TreasuryToken(address(new ERC1967Proxy(
            address(ttzaImpl),
            abi.encodeCall(TreasuryToken.initialize, ("1Remit ZA Token", "TTZA", admin, 0))
        )));

        // Deploy Vault
        Vault vaultImpl = new Vault();
        vault = Vault(address(new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(Vault.initialize, (admin, address(swapRouter), address(usdcToken)))
        )));

        // Deploy Consumer
        Consumer consumerImpl = new Consumer();
        consumer = Consumer(address(new ERC1967Proxy(
            address(consumerImpl),
            abi.encodeCall(Consumer.initialize, (
                admin, SAFE_SINGLETON, address(factory), address(0)
            ))
        )));

        // Wire
        vm.startPrank(admin);
        vault.addToken(address(zarToken), ZAR_CODE);
        vault.addToken(address(usdcToken), USDC_CODE);
        vault.setConsumerContract(address(consumer));
        vault.setCurrencyTreasuryToken(ZAR_CODE, address(ttza));
        vault.grantRole(vault.ADMIN_EXECUTOR_ROLE(), backend);
        ttza.grantRole(ttza.MINTER_ROLE(), address(vault));
        ttza.grantRole(ttza.MINTER_ROLE(), backend);
        consumer.grantRole(consumer.REGISTRAR_ROLE(),   backend);
        consumer.grantRole(consumer.KYC_UPDATER_ROLE(), backend);
        consumer.grantRole(consumer.RECORDER_ROLE(),    backend);
        vm.stopPrank();

        // Register ZA sender (step 1)
        vm.prank(backend);
        walletZA = consumer.registerConsumer(
            keccak256("alice.1remit.eth"),
            keccak256("Alice"),
            keccak256("ZA"),
            1,               // kycLevel 1
            makeAddr("aliceOwner")
        );

        // Register ZW recipient (step 1)
        vm.prank(backend);
        walletZW = consumer.registerConsumer(
            keccak256("bob.1remit.eth"),
            keccak256("Bob"),
            keccak256("ZW"),
            1,
            makeAddr("bobOwner")
        );
    }

    // ── Full remittance flow ──────────────────────────────────────────────────

    function test_Integration_FullRemittanceFlow() public {
        // Step 2: credit sender with 1,000.00 ZAR (100_000 in 2-decimal units)
        vm.prank(backend);
        vault.adminCredit(walletZA, REMIT_AMOUNT, ZAR_CODE);

        // Step 2 also mints TTZA so the burn in payRemittance succeeds
        vm.prank(backend);
        ttza.mint(walletZA, REMIT_AMOUNT);

        uint256 supplyBefore = ttza.totalSupply();

        // Step 3: assert unified balance
        assertEq(vault.unifiedBalance(walletZA, ZAR_CODE), REMIT_AMOUNT);

        // Step 4: checkKycLimit returns true for amount within level 1 daily (500_000)
        assertTrue(consumer.checkKycLimit(walletZA, REMIT_AMOUNT));

        // Step 5: lock and pay remittance
        vm.prank(backend);
        vault.startRemittance(walletZA);

        vm.prank(backend);
        vault.payRemittance(walletZA, REMIT_AMOUNT, ZAR_CODE, ZW_CODE);

        // Step 6: sender balance is 0
        assertEq(vault.unifiedBalance(walletZA, ZAR_CODE), 0);

        // Step 7: TTZA total supply decreased by remit amount
        assertEq(ttza.totalSupply(), supplyBefore - REMIT_AMOUNT);
        assertEq(ttza.balanceOf(walletZA), 0);

        // Record compliance log (backend calls this after partner confirms payout)
        DataTypes.RemittanceRecord memory rec = DataTypes.RemittanceRecord({
            sender:                 walletZA,
            recipientMobileHash:    keccak256("+263771000001"),
            destinationCountryCode: ZW_CODE,
            amountSent:             REMIT_AMOUNT,
            timestamp:              block.timestamp,
            partnerId:              keccak256("partner1")
        });

        vm.prank(backend);
        consumer.recordRemittance(rec);

        // Step 8: remittanceLog[0] fields correct
        assertEq(consumer.remittanceLogLength(), 1);
        (
            address recSender,
            bytes32 recMobileHash,
            bytes32 recDestCode,
            uint256 recAmount,
            ,
            bytes32 recPartner
        ) = consumer.remittanceLog(0);
        assertEq(recSender,    walletZA);
        assertEq(recMobileHash, keccak256("+263771000001"));
        assertEq(recDestCode,  ZW_CODE);
        assertEq(recAmount,    REMIT_AMOUNT);
        assertEq(recPartner,   keccak256("partner1"));

        // Step 9: getSentToday == remit amount
        assertEq(consumer.getSentToday(walletZA), REMIT_AMOUNT);

        // Step 10: second remittance attempt while a NEW lock would conflict
        // (the lock was cleared by payRemittance; test concurrent lock protection separately)
        vm.prank(backend);
        vault.startRemittance(walletZA); // re-lock (balance is 0, will fail at payRemittance not startRemittance)

        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Vault.RemittanceLocked.selector, walletZA));
        vault.startRemittance(walletZA); // second concurrent start reverts
    }

    // ── Fork test: USD purchase flow ──────────────────────────────────────────

    /// @dev Forks Sepolia, deploys fresh contracts, and tests purchaseUsd accounting
    ///      using a MockSwapRouter (no real ZARP/USDC pool required on Sepolia).
    ///      Set RPC_URL_SEPOLIA in .env to run; skipped otherwise.
    function testFork_PurchaseUsd() public {
        string memory rpcUrl = vm.envOr("RPC_URL_SEPOLIA", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true);
            return;
        }

        vm.createSelectFork(rpcUrl);

        // Re-deploy everything on the fork (setUp ran before fork; re-init fresh state)
        MockSwapRouter  forkRouter   = new MockSwapRouter();
        MockERC20       forkZarp     = new MockERC20("ZARP",     "ZARP", 2);
        MockERC20       forkUsdc     = new MockERC20("USD Coin", "USDC", 6);

        TreasuryToken forkTtzaImpl = new TreasuryToken();
        TreasuryToken forkTtza = TreasuryToken(address(new ERC1967Proxy(
            address(forkTtzaImpl),
            abi.encodeCall(TreasuryToken.initialize, ("1Remit ZA Token", "TTZA", admin, 0))
        )));

        Vault forkVaultImpl = new Vault();
        Vault forkVault = Vault(address(new ERC1967Proxy(
            address(forkVaultImpl),
            abi.encodeCall(Vault.initialize, (admin, address(forkRouter), address(forkUsdc)))
        )));

        vm.startPrank(admin);
        forkVault.addToken(address(forkZarp), ZAR_CODE);
        forkVault.setCurrencyTreasuryToken(ZAR_CODE, address(forkTtza));
        forkVault.grantRole(forkVault.ADMIN_EXECUTOR_ROLE(), backend);
        forkTtza.grantRole(forkTtza.MINTER_ROLE(), address(forkVault));
        forkTtza.grantRole(forkTtza.MINTER_ROLE(), backend);
        vm.stopPrank();

        // Seed: admin wallet holds ZARP in vault; swap router holds USDC to send back
        uint256 zarAmount  = 100_000; // 1,000.00 ZAR
        uint256 usdcOut    = 5_000_000; // 50.00 USDC (6 decimals)

        zarToken.mint(admin, zarAmount);
        vm.prank(admin);
        zarToken.approve(address(forkVault), zarAmount);
        forkVault.depositFromExternal(admin, walletZA, address(zarToken), zarAmount);

        // Seed USDC into the mock router (it will push this to the vault as swap output)
        forkUsdc.mint(address(forkRouter), usdcOut);

        // Mint TTZA to walletZA so the burn succeeds
        vm.prank(backend);
        forkTtza.mint(walletZA, zarAmount);

        uint256 vaultUsdcBefore = forkUsdc.balanceOf(address(forkVault));

        // Execute purchaseUsd
        vm.prank(backend);
        forkVault.purchaseUsd(walletZA, zarAmount, ZAR_CODE, 3000, usdcOut);

        // Assert: USDC balance credited to walletZA in vault
        assertEq(
            forkVault.unifiedBalance(walletZA, USDC_CODE),
            usdcOut
        );

        // Assert: vault received USDC from router
        assertEq(
            forkUsdc.balanceOf(address(forkVault)),
            vaultUsdcBefore + usdcOut
        );

        // Assert: walletZA ZAR balance debited
        assertEq(forkVault.unifiedBalance(walletZA, ZAR_CODE), 0);

        // Assert: TTZA burned from walletZA
        assertEq(forkTtza.balanceOf(walletZA), 0);
    }
}
