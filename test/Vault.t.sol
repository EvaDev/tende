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

    function test_Transfer_DifferentCountry_RevertCountryMismatch() public {
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        mockConsumer.setConsumer(bob,   keccak256("ZW"), 1);

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            Vault.CountryMismatch.selector,
            keccak256("ZA"),
            keccak256("ZW")
        ));
        vault.transfer(bob, 40_000, ZAR_CODE);
    }

    function test_Transfer_ToUnregisteredAddress_Succeeds() public {
        // Only alice registered — country check skipped when recipient not in Consumer
        mockConsumer.setConsumer(alice, keccak256("ZA"), 1);
        // bob NOT registered

        vm.prank(backend);
        vault.adminCredit(alice, CREDIT_AMOUNT, ZAR_CODE);

        vm.prank(alice);
        vault.transfer(bob, 40_000, ZAR_CODE); // no revert expected

        assertEq(vault.unifiedBalance(bob, ZAR_CODE), 40_000);
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

    // ── Fuzz ──────────────────────────────────────────────────────────────────

    /// @dev Credit then transfer — balances must be consistent and sum-preserving.
    function testFuzz_CreditTransfer(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);

        vm.prank(backend);
        vault.adminCredit(alice, amount, ZAR_CODE);
        assertEq(vault.unifiedBalance(alice, ZAR_CODE), amount);

        vm.prank(alice);
        vault.transfer(bob, amount, ZAR_CODE);

        assertEq(vault.unifiedBalance(alice, ZAR_CODE), 0);
        assertEq(vault.unifiedBalance(bob,   ZAR_CODE), amount);
    }
}
