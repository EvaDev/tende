// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}            from "forge-std/Test.sol";
import {ERC1967Proxy}    from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {Consumer}   from "../src/Consumer.sol";
import {DataTypes}  from "../src/libraries/DataTypes.sol";

import {MockSafeProxyFactory} from "./mocks/MockSafeProxyFactory.sol";

contract ConsumerTest is Test {
    Consumer              internal consumer;
    MockSafeProxyFactory  internal factory;

    address internal admin    = makeAddr("admin");
    address internal backend  = makeAddr("backend");
    address internal stranger = makeAddr("stranger");

    address internal constant SAFE_SINGLETON = address(0xAA);

    bytes32 internal constant ZA_CODE = keccak256("ZA");
    bytes32 internal constant ZW_CODE = keccak256("ZW");

    // Reused wallet address after first registerConsumer call
    address internal walletZA;

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        vm.warp(1_000_000); // predictable timestamp for KYC bucket tests

        factory = new MockSafeProxyFactory();

        Consumer impl = new Consumer();
        consumer = Consumer(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Consumer.initialize, (
                admin,
                SAFE_SINGLETON,
                address(factory),
                address(0) // no fallback handler needed in tests
            ))
        )));

        vm.startPrank(admin);
        consumer.grantRole(consumer.REGISTRAR_ROLE(),   backend);
        consumer.grantRole(consumer.KYC_UPDATER_ROLE(), backend);
        consumer.grantRole(consumer.RECORDER_ROLE(),    backend);
        vm.stopPrank();

        // Register first consumer so tests can reference walletZA
        vm.prank(backend);
        walletZA = consumer.registerConsumer(
            keccak256("alice.1remit.eth"),
            keccak256("Alice"),
            ZA_CODE,
            1,
            makeAddr("aliceOwner")
        );
    }

    // ── registerConsumer ──────────────────────────────────────────────────────

    function test_RegisterConsumer_StoresDataAndEmitsEvent() public {
        bytes32 ens      = keccak256("bob.1remit.eth");
        bytes32 namehash = keccak256("Bob");
        address owner    = makeAddr("bobOwner");

        vm.expectEmit(false, true, false, false, address(consumer));
        emit Consumer.ConsumerRegistered(address(0), 1001, ZA_CODE, 1);

        vm.prank(backend);
        address wallet = consumer.registerConsumer(ens, namehash, ZA_CODE, 1, owner);

        assertTrue(wallet != address(0));
        assertTrue(consumer.isRegistered(wallet));

        DataTypes.ConsumerData memory cd = consumer.getConsumer(wallet);
        assertEq(cd.countryCode,      ZA_CODE);
        assertEq(cd.kycLevel,         1);
        assertTrue(cd.isActive);
        assertEq(cd.globalConsumerId, 1001);
    }

    function test_RegisterConsumer_RevertWrongRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        consumer.registerConsumer(bytes32(0), bytes32(0), ZA_CODE, 1, makeAddr("x"));
    }

    function test_RegisterConsumer_RevertDuplicateEns() public {
        bytes32 ens = keccak256("duplicate.1remit.eth");

        vm.prank(backend);
        consumer.registerConsumer(ens, bytes32(0), ZA_CODE, 1, makeAddr("x1"));

        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Consumer.EnsAlreadyRegistered.selector, ens));
        consumer.registerConsumer(ens, bytes32(0), ZA_CODE, 1, makeAddr("x2"));
    }

    function test_RegisterConsumer_RevertPilotCap() public {
        // Reduce cap to 1 — walletZA was registered in setUp so count = 1
        vm.prank(admin);
        consumer.setMaxConsumers(1);

        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Consumer.PilotCapReached.selector, 1, 1));
        consumer.registerConsumer(bytes32(0), bytes32(0), ZA_CODE, 1, makeAddr("extra"));
    }

    // ── updateKycLevel ────────────────────────────────────────────────────────

    function test_UpdateKycLevel_CorrectRoleUpdates() public {
        vm.expectEmit(true, false, false, true, address(consumer));
        emit Consumer.KycLevelUpdated(walletZA, 1, 2);

        vm.prank(backend);
        consumer.updateKycLevel(walletZA, 2);

        assertEq(consumer.getKycLevel(walletZA), 2);
    }

    function test_UpdateKycLevel_RevertWrongRole() public {
        vm.prank(stranger);
        vm.expectRevert();
        consumer.updateKycLevel(walletZA, 2);
    }

    function test_UpdateKycLevel_RevertNotRegistered() public {
        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(Consumer.NotRegistered.selector, stranger));
        consumer.updateKycLevel(stranger, 1);
    }

    // ── recordRemittance ─────────────────────────────────────────────────────

    function _makeRecord(address sender, uint256 amount) internal view returns (DataTypes.RemittanceRecord memory) {
        return DataTypes.RemittanceRecord({
            sender:                 sender,
            recipientMobileHash:    keccak256("+263771000000"),
            destinationCountryCode: ZW_CODE,
            amountSent:             amount,
            timestamp:              block.timestamp,
            partnerId:              keccak256("partner1")
        });
    }

    function test_RecordRemittance_AppendsLogAndUpdatesAccumulators() public {
        uint256 amount = 50_000;

        vm.expectEmit(true, true, false, true, address(consumer));
        emit Consumer.RemittanceRecorded(walletZA, ZW_CODE, amount, keccak256("partner1"), 0);

        vm.prank(backend);
        consumer.recordRemittance(_makeRecord(walletZA, amount));

        assertEq(consumer.remittanceLogLength(), 1);
        assertEq(consumer.getSentToday(walletZA), amount);
        assertEq(consumer.getSentThisMonth(walletZA), amount);
    }

    function test_RecordRemittance_RevertAtKycLevel1DailyLimit() public {
        uint256 amount = DataTypes.KYC1_DAILY;

        vm.prank(backend);
        consumer.recordRemittance(_makeRecord(walletZA, amount));

        uint256 secondAmount = 100;
        vm.prank(backend);
        vm.expectRevert(abi.encodeWithSelector(
            Consumer.KycLimitExceeded.selector,
            walletZA,
            secondAmount,
            amount + secondAmount
        ));
        consumer.recordRemittance(_makeRecord(walletZA, secondAmount));
    }

    // ── Daily limit reset (new day bucket) ───────────────────────────────────

    function test_DailyLimitResets_NextDayBucket() public {
        // Exhaust today's limit
        vm.prank(backend);
        consumer.recordRemittance(_makeRecord(walletZA, DataTypes.KYC1_DAILY));

        // Advance to next day
        vm.warp(block.timestamp + 1 days);

        // Daily limit has reset — same amount should succeed
        assertTrue(consumer.checkKycLimit(walletZA, DataTypes.KYC1_DAILY));

        vm.prank(backend);
        consumer.recordRemittance(_makeRecord(walletZA, DataTypes.KYC1_DAILY));

        assertEq(consumer.getSentToday(walletZA), DataTypes.KYC1_DAILY);
    }

    // ── Monthly limit accumulates across days within the month bucket ─────────

    function test_MonthlyLimitAccumulatesAcrossDays() public {
        // KYC1_MONTHLY = 2_000_000. Send KYC1_DAILY (500_000) over 4 days.
        // All 4 days fall in the same month bucket (block.timestamp / 2592000 is unchanged).
        for (uint256 day = 0; day < 4; day++) {
            vm.prank(backend);
            consumer.recordRemittance(_makeRecord(walletZA, DataTypes.KYC1_DAILY));
            if (day < 3) vm.warp(block.timestamp + 1 days);
        }

        // monthlySent == KYC1_MONTHLY. Any further amount — even 1 — should now fail.
        vm.warp(block.timestamp + 1 days); // new day so daily resets, but monthly is full
        assertFalse(consumer.checkKycLimit(walletZA, 1));
    }

    // ── UUPS ──────────────────────────────────────────────────────────────────

    function test_Upgrade_SuccessFromAdmin() public {
        Consumer newImpl = new Consumer();
        uint256 countBefore = consumer.consumerCount();

        vm.prank(admin);
        UUPSUpgradeable(address(consumer)).upgradeToAndCall(address(newImpl), "");

        assertEq(consumer.consumerCount(), countBefore);
    }

    function test_Upgrade_RevertFromNonAdmin() public {
        Consumer newImpl = new Consumer();

        vm.prank(stranger);
        vm.expectRevert();
        UUPSUpgradeable(address(consumer)).upgradeToAndCall(address(newImpl), "");
    }
}
