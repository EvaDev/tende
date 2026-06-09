// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for TreasuryToken used by Vault.
///         Vault must hold MINTER_ROLE on each TreasuryToken it interacts with.
interface ITreasuryToken {
    /// @notice Burn `amount` from `from`. Caller must have MINTER_ROLE.
    ///         CRITICAL: must always be called after remittance confirms — skipping causes token leak.
    function burn(address from, uint256 amount) external;
}
