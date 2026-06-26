// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}         from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Vault}         from "../src/Vault.sol";
import {TreasuryToken} from "../src/TreasuryToken.sol";

import {MockConsumer}   from "./mocks/MockConsumer.sol";
import {MockERC20}      from "./mocks/MockERC20.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

contract VaultTest is Test {
    Vault          internal vault;
    TreasuryToken  internal ttza;
    MockConsumer   internal mockConsumer;
    MockERC20      internal zarToken;
    MockERC20      internal usdcToken;
    MockSwapRouter internal swapRouter;

    address internal admin    = makeAddr("admin");
    address internal backend  = makeAddr("backend");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant ZAR_CODE  = keccak256("ZAR");
    bytes32 internal constant ZW_CODE   = keccak256("ZW");
    bytes32 internal constant ZWL_CODE  = keccak256("ZWL");
    bytes32 internal constant USDC_CODE = keccak256("USDC");

    uint256 internal constant CREDIT_AMOUNT = 100_000; // 1,000.00

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        swapRouter = new MockSwapRouter();
        usdcToken  = new MockERC20("USD Coin", "USDC", 6);
        zarToken   = new MockERC20("ZARP", "ZARP", 2);
        mockConsumer = new MockConsumer();

        // Deploy Vault proxy
        Vault impl = new Vault();
        vault = Vault(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Vault.initialize, (admin, address(swapRouter), address(usdcToken)))
        )));

        // Deploy TTZA proxy (Vault needs MINTER_ROLE to burn it)
        TreasuryToken ttzaImpl = new TreasuryToken();
        ttza = TreasuryToken(address(new ERC1967Proxy(
            address(ttzaImpl),
            abi.encodeCall(TreasuryToken.initialize, ("1Remit ZA Token", "TTZA", admin, 0))
        )));

        vm.startPrank(admin);
        vault.addToken(address(zarToken), ZAR_CODE);
        vault.addToken(address(usdcToken), USDC_CODE);
        vault.setConsumerContract(address(mockConsumer));
        vault.setCurrencyTreasuryToken(ZAR_CODE,  address(ttza));
        vault.setCurrencyTreasuryToken(ZWL_CODE,  address(ttza)); // reuse for test simplicity
        vault.grantRole(vault.ADMIN_EXECUTOR_ROLE(), backend);
        ttza.grantRole(ttza.MINTER_ROLE(), address(vault));
        ttza.grantRole(ttza.MINTER_ROLE(), backend);
        vm.stopPrank();
    }

    // ── adminCredit ───────────────────────────────────────────────────────────

    function test_AdminCredit_CorrectRoleCreditsBalance() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit Vault.Credited(alice, ZAR_CODE, CREDIT_AMOUNT, backend);

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        assertEq(vault.unifiedBalance(alice, ZAR_CODE), CREDIT_AMOUNT);
    }

    function test_AdminCredit_RevertWrongRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);
    }

    // ── P2P Transfer ──────────────────────────────────────────────────────────

    function test_Transfer_SameCountry_Success() public {
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        mockConsumer.setConsumer(bob,   keccak256("ZA"), 1);

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Vault.Transferred(alice, bob, 40_000, ZAR_CODE);

        vm.prank(alice);
        vault.transfer(bob, 40_000, ZAR_CODE);

        assertEq(vault.unifiedBalance(alice, ZAR_CODE), 60_000);
        assertEq(vault.unifiedBalance(bob,   ZAR_CODE), 40_000);
    }

    function test_Transfer_CrossCountry_BothKycd_Succeeds() public {
        // Vault balances may cross borders when both parties are KYC'd
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        mockConsumer.setConsumer(bob,   keccak256("ZW"), 1);

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        vm.prank(alice);
        vault.transfer(bob, 40_000, ZAR_CODE);

        assertEq(vault.unifiedBalance(alice, ZAR_CODE), 60_000);
        assertEq(vault.unifiedBalance(bob,   ZAR_CODE), 40_000);
    }

    function test_Transfer_UnregisteredRecipient_Reverts() public {
        // Recipient not a consumer → getKycLevel 0 → fails the KYC gate
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        // bob NOT registered

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            Vault.KycLevelInsufficient.selector, bob, uint8(0), uint8(1)
        ));
        vault.transfer(bob, 40_000, ZAR_CODE);
    }

    function test_Transfer_ToTrustedMerchant_NoMerchantKyc_Succeeds() public {
        // Consumer pays a merchant in USDC. Merchant is NOT a consumer, but is a
        // trusted counterparty (KYB-verified) → transfer allowed.
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        // bob = merchant, unregistered, no KYC
        vm.prank(backend);
        vault.setTrustedCounterparty(bob, true);

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, USDC_CODE);

        vm.prank(alice);
        vault.transfer(bob, 40_000, USDC_CODE);

        assertEq(vault.unifiedBalance(bob, USDC_CODE), 40_000);
    }

    function test_SetTrustedCounterparty_WrongRole_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setTrustedCounterparty(bob, true);
    }

    function test_Transfer_SenderNotKycd_Reverts() public {
        // Sender registered but KYC level 0 → blocked even for a domestic transfer
        mockConsumer.setConsumer(alice, keccak256("ZA"), 0);
        mockConsumer.setConsumer(bob,   keccak256("ZA"), 1);

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            Vault.KycLevelInsufficient.selector, alice, uint8(0), uint8(1)
        ));
        vault.transfer(bob, 40_000, ZAR_CODE);
    }

    function test_Transfer_InsufficientBalance_Reverts() public {
        // alice has zero balance
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            Vault.InsufficientBalance.selector,
            alice, ZAR_CODE, 0, 1
        ));
        vault.transfer(bob, 1, ZAR_CODE);
    }

    // ── payRemittance ─────────────────────────────────────────────────────────

    function test_PayRemittance_DeductsBalanceBurnsTreasuryTokenEmitsEvent() public {
        // Give alice Vault balance + TTZA tokens
        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);
        vm.prank(backend);
        ttza.mint(alice, CREDIT_AMOUNT);

        // Lock
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        vm.prank(backend);
        vault.startRemittance(alice);

        // Expect event
        vm.expectEmit(true, false, false, true, address(vault));
        emit Vault.RemittanceSettled(alice, CREDIT_AMOUNT, ZAR_CODE, ZW_CODE);

        vm.prank(backend);
        vault.payRemittance(alice, CREDIT_AMOUNT, ZAR_CODE, ZW_CODE);

        assertEq(vault.unifiedBalance(alice, ZAR_CODE), 0);
        assertEq(ttza.balanceOf(alice), 0);
        assertFalse(vault.remittanceLocked(alice));
    }

    function test_PayRemittance_ConcurrentLock_SecondStartReverts() public {
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);

        vm.prank(backend);
        vault.startRemittance(alice);

        // Second startRemittance while locked must revert
        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Vault.RemittanceLocked.selector, alice));
        vault.startRemittance(alice);
    }

    function test_PayRemittance_WithoutLock_Reverts() public {
        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        // No startRemittance called
        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Vault.RemittanceNotLocked.selector, alice));
        vault.payRemittance(alice, CREDIT_AMOUNT, ZAR_CODE, ZW_CODE);
    }

    // ── depositFromExternal ───────────────────────────────────────────────────

    function test_DepositFromExternal_TransfersTokensAndCreditsBalance() public {
        uint256 amount = 50_000;
        zarToken.mint(alice, amount);

        vm.prank(alice);
        zarToken.approve(address(vault), amount);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Vault.Deposited(alice, alice, address(zarToken), amount);

        vault.depositFromExternal(alice, alice, address(zarToken), amount);

        assertEq(zarToken.balanceOf(address(vault)), amount);
        assertEq(vault.unifiedBalance(alice, ZAR_CODE), amount);
    }

    function test_DepositFromExternal_UnsupportedToken_Reverts() public {
        MockERC20 unknown = new MockERC20("X", "X", 2);
        unknown.mint(alice, 1_000);

        vm.prank(alice);
        unknown.approve(address(vault), 1_000);

        vm.expectRevert(abi.encodeWithSelector(Vault.TokenNotSupported.selector, address(unknown)));
        vault.depositFromExternal(alice, alice, address(unknown), 1_000);
    }

    // ── Share ledger ──────────────────────────────────────────────────────────

    function test_Shares_BootstrapOneToOne() public {
        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        // First credit mints shares 1:1 with assets
        assertEq(vault.sharesOf(alice, ZAR_CODE), CREDIT_AMOUNT);
        assertEq(vault.totalShares(ZAR_CODE), CREDIT_AMOUNT);
        assertEq(vault.totalAssets(ZAR_CODE), CREDIT_AMOUNT);
        assertEq(vault.unifiedBalance(alice, ZAR_CODE), CREDIT_AMOUNT);
    }

    function test_AdminDebit_BurnsSharesAndReducesAssets() public {
        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);
        vm.prank(backend);
        vault.adminDebit(alice, 40_000, ZAR_CODE);

        assertEq(vault.unifiedBalance(alice, ZAR_CODE), 60_000);
        assertEq(vault.totalAssets(ZAR_CODE), 60_000);
        assertEq(vault.totalShares(ZAR_CODE), 60_000);
    }

    // ── Yield harvesting ──────────────────────────────────────────────────────

    function test_Harvest_NoYieldWithoutSurplus_Reverts() public {
        uint256 amount = 50_000;
        zarToken.mint(alice, amount);
        vm.prank(alice);
        zarToken.approve(address(vault), amount);
        vault.depositFromExternal(alice, alice, address(zarToken), amount);

        // totalAssets == holdings → nothing to harvest
        assertEq(vault.harvestableYield(ZAR_CODE), 0);
        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Vault.NoYield.selector, ZAR_CODE));
        vault.harvest(ZAR_CODE, admin, 1_000);
    }

    function test_Harvest_LiftsPricePerShareForHolders() public {
        // Two holders deposit; recorded assets == holdings, price-per-share == 1
        uint256 aDep = 100_000;
        uint256 bDep = 300_000;
        zarToken.mint(alice, aDep);
        zarToken.mint(bob,   bDep);
        vm.prank(alice); zarToken.approve(address(vault), aDep);
        vm.prank(bob);   zarToken.approve(address(vault), bDep);
        vault.depositFromExternal(alice, alice, address(zarToken), aDep);
        vault.depositFromExternal(bob,   bob,   address(zarToken), bDep);

        // Yield arrives as extra backing tokens (e.g. rebasing/strategy return)
        uint256 yield = 40_000;
        zarToken.mint(address(vault), yield);
        assertEq(vault.harvestableYield(ZAR_CODE), yield);

        uint16 feeBps = 2_500; // 25% platform
        uint256 expectedPlatformCut = (yield * feeBps) / 10_000; // 10,000
        uint256 expectedUserYield   = yield - expectedPlatformCut; // 30,000

        vm.expectEmit(true, false, false, true, address(vault));
        emit Vault.YieldHarvested(ZAR_CODE, yield, expectedPlatformCut, expectedUserYield, admin);

        vm.prank(backend);
        uint256 userYield = vault.harvest(ZAR_CODE, admin, feeBps);
        assertEq(userYield, expectedUserYield);

        // Platform cut swept as real tokens; shares unchanged
        assertEq(zarToken.balanceOf(admin), expectedPlatformCut);
        assertEq(vault.totalShares(ZAR_CODE), aDep + bDep);
        assertEq(vault.totalAssets(ZAR_CODE), aDep + bDep + expectedUserYield);

        // User yield distributed pro-rata via price-per-share: alice 25%, bob 75%
        // alice: 100k/400k * 30k = 7,500 ; bob: 300k/400k * 30k = 22,500
        assertEq(vault.unifiedBalance(alice, ZAR_CODE), aDep + 7_500);
        assertEq(vault.unifiedBalance(bob,   ZAR_CODE), bDep + 22_500);

        // Re-harvest yields nothing
        assertEq(vault.harvestableYield(ZAR_CODE), 0);
    }

    function test_Harvest_WrongRole_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.harvest(ZAR_CODE, admin, 1_000);
    }

    function test_Harvest_FeeTooHigh_Reverts() public {
        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Vault.FeeTooHigh.selector, uint16(10_001)));
        vault.harvest(ZAR_CODE, admin, 10_001);
    }

    function test_Withdraw_FullBalanceAfterYield_LeavesNoShareDust() public {
        uint256 dep = 100_000;
        zarToken.mint(alice, dep);
        vm.prank(alice); zarToken.approve(address(vault), dep);
        vault.depositFromExternal(alice, alice, address(zarToken), dep);

        // Yield bumps alice's balance above her deposit
        zarToken.mint(address(vault), 10_000);
        vm.prank(backend);
        vault.harvest(ZAR_CODE, admin, 0); // 0% fee → all to alice

        uint256 bal = vault.unifiedBalance(alice, ZAR_CODE);
        assertEq(bal, 110_000);

        // Withdraw the full asset balance — no share dust should remain
        vm.prank(backend);
        vault.withdrawToExternal(alice, alice, address(zarToken), bal);
        assertEq(vault.sharesOf(alice, ZAR_CODE), 0);
        assertEq(vault.unifiedBalance(alice, ZAR_CODE), 0);
    }

    // ── Fuzz ──────────────────────────────────────────────────────────────────

    /// @dev Credit then transfer — balances must be consistent and sum-preserving.
    function testFuzz_CreditTransfer(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);

        // Both parties must be KYC'd consumers for a Vault transfer
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        mockConsumer.setConsumer(bob,   keccak256("ZA"), 1);

        vm.prank(backend);
        vault.adminCredit(alice, amount, ZAR_CODE);
        assertEq(vault.unifiedBalance(alice, ZAR_CODE), amount);

        vm.prank(alice);
        vault.transfer(bob, amount, ZAR_CODE);

        assertEq(vault.unifiedBalance(alice, ZAR_CODE), 0);
        assertEq(vault.unifiedBalance(bob,   ZAR_CODE), amount);
    }
}
