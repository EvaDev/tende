// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Consumer used by Vault for country-matching and KYC gating.
interface IConsumer {
    /// @notice Returns true if `wallet` is a registered, active spend wallet.
    function isRegistered(address wallet) external view returns (bool);

    /// @notice Returns the bytes32 country code for the consumer that owns `wallet`.
    ///         Returns bytes32(0) if not registered.
    function getCountryCode(address wallet) external view returns (bytes32);

    /// @notice Returns the KYC level for the consumer that owns `wallet`.
    ///         Returns 0 if not registered.
    function getKycLevel(address wallet) external view returns (uint8);
}
