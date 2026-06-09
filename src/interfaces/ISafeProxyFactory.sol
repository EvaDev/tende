// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Safe v1.4.1 SafeProxyFactory.
///         Mainnet / Sepolia / all major chains: 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
///         (deterministic CREATE2 — same address everywhere)
interface ISafeProxyFactory {
    function createProxyWithNonce(
        address _singleton,
        bytes memory initializer,
        uint256 saltNonce
    ) external returns (address proxy);
}
