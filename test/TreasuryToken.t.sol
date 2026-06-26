// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}            from "forge-std/Test.sol";
import {ERC1967Proxy}    from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {TreasuryToken} from "../src/TreasuryToken.sol";
import {MockConsumer}  from "./mocks/MockConsumer.sol";

contract TreasuryTokenTest is Test {
    TreasuryToken internal token;
    MockConsumer  internal consumer;

    address internal admin    = makeAddr("admin");
    address internal minter   = makeAddr("minter");
    address internal complianceOp    = makeAddr("complianceOp");
    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant ZA = keccak256("ZA");
    bytes32 internal constant ZW = keccak256("ZW");

    uint256 internal constant INITIAL_SUPPLY = 100_000; // 1,000.00 in 2-decimal units

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        TreasuryToken impl = new TreasuryToken();
        token = TreasuryToken(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(TreasuryToken.initialize, ("1Remit ZA Token", "TTZA", admin, INITIAL_SUPPLY))
        )));

        consumer = new MockConsumer();

        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), minter);
        token.grantRole(token.COMPLIANCE_ROLE(), complianceOp);
        token.setConsumerContract(address(consumer));
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

    // ── Compliance gate (v1.1.0) ───────────────────────────────────────────────

    function test_Compliance_DisabledByDefault_TransferAllowed() public {
        vm.prank(minter);
        token.mint(alice, 1_000);
        // complianceEnabled is false → no KYC/country gate
        vm.prank(alice);
        token.transfer(bob, 400);
        assertEq(token.balanceOf(bob), 400);
    }

    function test_Compliance_DomesticTreasury_NoKycRequired() public {
        // Same country, both KYC level 0 → treasury domestic P2P allowed without KYC
        consumer.setConsumer(alice, ZA, 0);
        consumer.setConsumer(bob,   ZA, 0);
        vm.prank(admin);
        token.setComplianceEnabled(true);

        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(alice);
        token.transfer(bob, 400);
        assertEq(token.balanceOf(bob), 400);
    }

    function test_Compliance_UnverifiedRecipientReverts() public {
        consumer.setConsumer(alice, ZA, 1); // bob NOT registered
        vm.prank(admin);
        token.setComplianceEnabled(true);

        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.RecipientNotVerified.selector, bob));
        token.transfer(bob, 400);
    }

    function test_Compliance_ConsumerToWhitelistedMerchant_Allowed() public {
        // Merchant is NOT a registered consumer, but is whitelisted as a trusted
        // settlement address → consumer can pay them in TT.
        consumer.setConsumer(alice, ZA, 0); // domestic consumer, no KYC
        vm.startPrank(admin);
        token.setComplianceEnabled(true);
        token.addToWhitelist(bob); // bob = merchant
        vm.stopPrank();

        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(alice);
        token.transfer(bob, 400);
        assertEq(token.balanceOf(bob), 400);
    }

    function test_Compliance_WhitelistedManagedByAgent() public {
        // Backend (COMPLIANCE_ROLE), not just admin, can whitelist a merchant
        vm.prank(complianceOp);
        token.addToWhitelist(bob);
        assertTrue(token.whitelisted(bob));

        vm.prank(stranger);
        vm.expectRevert();
        token.addToWhitelist(alice);
    }

    function test_Compliance_CrossBorder_Reverts() public {
        // Treasury token is country-specific → cross-border transfer is blocked,
        // regardless of KYC level (both fully KYC'd here).
        consumer.setConsumer(alice, ZA, 2);
        consumer.setConsumer(bob,   ZW, 2);
        vm.prank(admin);
        token.setComplianceEnabled(true);

        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.CrossBorderNotAllowed.selector, ZA, ZW));
        token.transfer(bob, 400);
    }

    // ── Partial freeze (v1.1.0) ─────────────────────────────────────────────────

    function test_Freeze_BlocksMovingFrozenPortion() public {
        vm.prank(minter);
        token.mint(alice, 1_000);

        vm.prank(complianceOp);
        token.freezePartialTokens(alice, 700); // only 300 spendable

        vm.prank(alice);
        token.transfer(bob, 300); // unfrozen portion → ok
        assertEq(token.balanceOf(bob), 300);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.InsufficientUnfrozenBalance.selector, alice, 0, 1));
        token.transfer(bob, 1); // would dip into frozen
    }

    function test_Freeze_CannotExceedBalance() public {
        vm.prank(minter);
        token.mint(alice, 500);
        vm.prank(complianceOp);
        vm.expectRevert(abi.encodeWithSelector(TreasuryToken.FreezeExceedsBalance.selector, alice, 500, 600));
        token.freezePartialTokens(alice, 600);
    }

    function test_Freeze_WrongRoleReverts() public {
        vm.prank(minter);
        token.mint(alice, 500);
        vm.prank(stranger);
        vm.expectRevert();
        token.freezePartialTokens(alice, 100);
    }

    function test_Unfreeze_RestoresSpendable() public {
        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(complianceOp);
        token.freezePartialTokens(alice, 700);
        vm.prank(complianceOp);
        token.unfreezePartialTokens(alice, 700);

        vm.prank(alice);
        token.transfer(bob, 1_000); // fully spendable again
        assertEq(token.balanceOf(bob), 1_000);
    }

    function test_Burn_AutoUnfreezesWhenBalanceDropsBelowFrozen() public {
        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(complianceOp);
        token.freezePartialTokens(alice, 1_000); // fully frozen

        // Privileged burn bypasses the freeze block and auto-unfreezes the burned part
        vm.prank(minter);
        token.burn(alice, 400);

        assertEq(token.balanceOf(alice), 600);
        assertEq(token.frozenTokens(alice), 600); // clamped to remaining balance
    }

    // ── Forced transfer (v1.1.0) ────────────────────────────────────────────────

    function test_ForcedTransfer_MovesFrozenTokens() public {
        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(complianceOp);
        token.freezePartialTokens(alice, 1_000);

        vm.expectEmit(true, true, false, true, address(token));
        emit TreasuryToken.ForcedTransfer(alice, bob, 1_000, complianceOp);

        vm.prank(complianceOp);
        token.forcedTransfer(alice, bob, 1_000); // clawback ignores freeze

        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), 1_000);
        assertEq(token.frozenTokens(alice), 0); // auto-cleared
    }

    function test_ForcedTransfer_BypassesBlacklistAndPause() public {
        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.startPrank(admin);
        token.addToBlacklist(alice); // sanctioned holder
        token.pause();               // token-wide pause
        vm.stopPrank();

        vm.prank(complianceOp);
        token.forcedTransfer(alice, bob, 1_000); // recovery still works

        assertEq(token.balanceOf(bob), 1_000);
    }

    function test_ForcedTransfer_WrongRoleReverts() public {
        vm.prank(minter);
        token.mint(alice, 1_000);
        vm.prank(stranger);
        vm.expectRevert();
        token.forcedTransfer(alice, bob, 100);
    }
}
