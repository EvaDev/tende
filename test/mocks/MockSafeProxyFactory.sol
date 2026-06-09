// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Returns a deterministic address per saltNonce — no real Safe deployed.
///      Consumer.sol doesn't verify the returned address has code, so this is safe for unit tests.
contract MockSafeProxyFactory {
    function createProxyWithNonce(
        address,
        bytes memory,
        uint256 saltNonce
    ) external pure returns (address proxy) {
        return address(uint160(uint256(keccak256(abi.encodePacked("safe", saltNonce)))));
    }
}
