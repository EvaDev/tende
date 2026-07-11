// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SessionTransferModule} from "../src/SessionTransferModule.sol";
import {Vault} from "../src/Vault.sol";
import {MockConsumer} from "./mocks/MockConsumer.sol";
import {MockSafe} from "./mocks/MockSafe.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SessionTransferModuleTest is Test {
    SessionTransferModule internal module;
    Vault          internal vault;
    MockSafe       internal safe;
    MockConsumer   internal mockConsumer;

    address internal alice    = makeAddr("alice");
    address internal bob      = makeAddr("bob");
    address internal sessionKey;
    uint256 internal sessionPk;

    bytes32 internal constant ZAR_CODE = keccak256("ZAR");

    function setUp() public {
        MockSwapRouter swapRouter = new MockSwapRouter();
        MockERC20 zarToken = new MockERC20("ZARP", "ZARP", 2);
        mockConsumer = new MockConsumer();

        Vault impl = new Vault();
        vault = Vault(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Vault.initialize, (address(this), address(swapRouter), address(0x1)))
        )));
        vault.addToken(address(zarToken), ZAR_CODE);
        vault.setConsumerContract(address(mockConsumer));

        module = new SessionTransferModule(address(vault));
        safe = new MockSafe();
        safe.enableModule(address(module));

        mockConsumer.setConsumer(address(safe), keccak256("ZA"), 1);
        mockConsumer.setConsumer(bob, keccak256("ZA"), 1);
        vault.adminCredit(address(safe), 100_000, ZAR_CODE);

        sessionPk = 0xA11CE;
        sessionKey = vm.addr(sessionPk);
    }

    function _registerSession(uint256 maxPerTx, uint256 dailyCap) internal {
        vm.prank(address(safe));
        module.addSessionKey(sessionKey, uint64(block.timestamp + 1 days), maxPerTx, dailyCap);
    }

    function _signTransfer(
        address to,
        uint256 amount,
        uint256 deadline
    ) internal view returns (bytes memory sig) {
        bytes32 digest = module.sessionTransferHash(address(safe), sessionKey, to, amount, ZAR_CODE, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionPk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function test_ExecuteTransfer_Success() public {
        _registerSession(50_000, 100_000);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signTransfer(bob, 40_000, deadline);

        module.executeTransfer(address(safe), sessionKey, bob, 40_000, ZAR_CODE, deadline, sig);

        assertEq(vault.unifiedBalance(bob, ZAR_CODE), 40_000);
        assertEq(vault.unifiedBalance(address(safe), ZAR_CODE), 60_000);
    }

    function test_ExecuteTransfer_RevertExceedsPerTxCap() public {
        _registerSession(10_000, 100_000);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signTransfer(bob, 40_000, deadline);

        vm.expectRevert(abi.encodeWithSelector(SessionTransferModule.AmountExceedsCap.selector, 40_000, 10_000));
        module.executeTransfer(address(safe), sessionKey, bob, 40_000, ZAR_CODE, deadline, sig);
    }

    function test_RemoveSessionKey_BlocksTransfer() public {
        _registerSession(50_000, 100_000);
        vm.prank(address(safe));
        module.removeSessionKey(sessionKey);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signTransfer(bob, 1_000, deadline);

        vm.expectRevert(abi.encodeWithSelector(SessionTransferModule.SessionInactive.selector, address(safe), sessionKey));
        module.executeTransfer(address(safe), sessionKey, bob, 1_000, ZAR_CODE, deadline, sig);
    }
}
