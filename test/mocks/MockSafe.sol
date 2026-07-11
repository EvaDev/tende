// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Safe stand-in for SessionTransferModule tests.
contract MockSafe {
    mapping(address => bool) public modules;

    function enableModule(address module) external {
        modules[module] = true;
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8
    ) external returns (bool success) {
        require(modules[msg.sender], "not module");
        (success,) = to.call{value: value}(data);
    }
}
