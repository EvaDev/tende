// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}            from "forge-std/Test.sol";
import {ERC1967Proxy}    from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {TreasuryToken} from "../src/TreasuryToken.sol";

contract TreasuryTokenTest is Test {
    TreasuryToken internal token;

    address internal admin    = makeAddr("admin");
    address internal minter   = makeAddr("minter");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant INITIAL_SUPPLY = 100_000; // 1,000.00 in 2-decimal units

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        TreasuryToken impl = new TreasuryToken();
        token = TreasuryToken(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(TreasuryToken.initialize, ("1Remit ZA Token", "TTZA", admin, INITIAL_SUPPLY))
        )));

        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), minter);
        vm.stopPrank();
    }

    // ── Mint ──────────────────────────────────────────────────────────────────

    function test_Mint_Success() public {
        uint256 amount = 5_000;
        uint256 supplyBefore = token.totalSupply();

        vm.expectEmit(true, false, false, true, address(token));
        emit TreasuryToken.Minted(alice, amount);

        vm.prank(minter);
        token.mint(alice, amount);

        assertEq(token.balanceOf(alice), amount);
        assertEq(token.totalSupply(), supplyBefore + amount);
    }

    function test_Mint_RevertWrongRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        token.mint(alice, 100);
    }

    function test_Mint_RevertBlacklistedRecipient() public {
        vm.prank(admin);
        token.addToBlacklist(alice);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.AccountBlacklisted.selector, alice));
        token.mint(alice, 100);
    }

    function test_Mint_RevertPaused() public {
        vm.prank(admin);
        token.pause();

        vm.prank(minter);
        vm.expectRevert();
        token.mint(alice, 100);
    }

    // ── Burn ──────────────────────────────────────────────────────────────────

    function test_Burn_Success() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        uint256 supplyBefore = token.totalSupply();

        vm.expectEmit(true, false, false, true, address(token));
        emit TreasuryToken.Burned(alice, 3_000);

        vm.prank(minter);
        token.burn(alice, 3_000);

        assertEq(token.balanceOf(alice), 2_000);
        assertEq(token.totalSupply(), supplyBefore - 3_000);
    }

    function test_Burn_RevertWrongRole() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        vm.prank(stranger);
        vm.expectRevert();
        token.burn(alice, 1_000);
    }

    function test_Burn_RevertInsufficientBalance() public {
        vm.prank(minter);
        token.mint(alice, 100);

        vm.prank(minter);
        vm.expectRevert();
        token.burn(alice, 101);
    }

    function test_Burn_RevertBlacklisted() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        vm.prank(admin);
        token.addToBlacklist(alice);

        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.AccountBlacklisted.selector, alice));
        token.burn(alice, 1_000);
    }

    // ── BurnOwn ───────────────────────────────────────────────────────────────

    function test_BurnOwn_Success() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        vm.prank(alice);
        token.burnOwn(2_000);

        assertEq(token.balanceOf(alice), 3_000);
    }

    function test_BurnOwn_RevertInsufficientBalance() public {
        // alice has no tokens
        vm.prank(alice);
        vm.expectRevert();
        token.burnOwn(1);
    }

    // ── Blacklist ─────────────────────────────────────────────────────────────

    function test_Transfer_RevertSenderBlacklisted() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        vm.prank(admin);
        token.addToBlacklist(alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.AccountBlacklisted.selector, alice));
        token.transfer(bob, 1_000);
    }

    function test_Transfer_RevertRecipientBlacklisted() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        vm.prank(admin);
        token.addToBlacklist(bob);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.AccountBlacklisted.selector, bob));
        token.transfer(bob, 1_000);
    }

    // ── Pause ─────────────────────────────────────────────────────────────────

    function test_Pause_BlocksAllTransfers() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        vm.prank(admin);
        token.pause();

        vm.prank(alice);
        vm.expectRevert();
        token.transfer(bob, 1_000);
    }

    function test_Unpause_RestoresTransfers() public {
        vm.prank(minter);
        token.mint(alice, 5_000);

        vm.startPrank(admin);
        token.pause();
        token.unpause();
        vm.stopPrank();

        vm.prank(alice);
        bool ok = token.transfer(bob, 1_000);

        assertTrue(ok);
        assertEq(token.balanceOf(bob), 1_000);
    }

    // ── Fuzz ──────────────────────────────────────────────────────────────────

    /// @dev Mint then burn — total supply must return to its pre-mint value.
    function testFuzz_MintBurn(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);

        uint256 supplyBefore = token.totalSupply();

        vm.prank(minter);
        token.mint(alice, amount);
        assertEq(token.totalSupply(), supplyBefore + amount);

        vm.prank(minter);
        token.burn(alice, amount);

        assertEq(token.totalSupply(), supplyBefore);
        assertEq(token.balanceOf(alice), 0);
    }

    // ── UUPS ──────────────────────────────────────────────────────────────────

    function test_Upgrade_SuccessFromAdmin() public {
        TreasuryToken newImpl = new TreasuryToken();
        uint256 supplyBefore = token.totalSupply();

        vm.prank(admin);
        UUPSUpgradeable(address(token)).upgradeToAndCall(address(newImpl), "");

        // Storage persists through upgrade
        assertEq(token.totalSupply(), supplyBefore);
        assertEq(token.symbol(), "TTZA");
    }

    function test_Upgrade_RevertFromNonAdmin() public {
        TreasuryToken newImpl = new TreasuryToken();

        vm.prank(stranger);
        vm.expectRevert();
        UUPSUpgradeable(address(token)).upgradeToAndCall(address(newImpl), "");
    }
}
