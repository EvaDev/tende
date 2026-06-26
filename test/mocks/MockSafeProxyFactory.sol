// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Returns a deterministic address per saltNonce — no real Safe deployed.
///      Consumer.sol doesn't verify the returned address has code, so this is safe
///      for unit tests. Captures the last setup() initializer so tests can assert
///      how the Safe would have been configured (plain 1.4.1 vs 4337-enabled).
contract MockSafeProxyFactory {
    address public lastSingleton;
    bytes   public lastInitializer;
    uint256 public lastSaltNonce;

    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    ) external returns (address proxy) {
        lastSingleton   = singleton;
        lastInitializer = initializer;
        lastSaltNonce   = saltNonce;
        return address(uint160(uint256(keccak256(abi.encodePacked("safe", saltNonce)))));
    }
}
