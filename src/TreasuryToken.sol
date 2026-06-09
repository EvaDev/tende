// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title TreasuryToken
/// @notice Permissioned ERC20 representing local-currency balance (e.g. TTZA, TTZW).
///         One deployment per country. Closed-loop — not publicly tradeable.
///         2 decimals (cents). Minted by backend on fiat deposit; burned on remit settlement.
contract TreasuryToken is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable
{
    // ── Roles ─────────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ── Custom errors ─────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error AccountBlacklisted(address account);
    error AccountNotWhitelisted(address account);

    // ── Access lists ──────────────────────────────────────────────────────────

    mapping(address => bool) public blacklisted;
    mapping(address => bool) public whitelisted;
    bool public whitelistEnabled;

    // ── Events ────────────────────────────────────────────────────────────────

    event AddedToBlacklist(address indexed account);
    event RemovedFromBlacklist(address indexed account);
    event AddedToWhitelist(address indexed account);
    event RemovedFromWhitelist(address indexed account);
    event WhitelistToggled(bool enabled);
    event Minted(address indexed to, uint256 amount);
    event Burned(address indexed from, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer ───────────────────────────────────────────────────────────

    /// @param name_          Token name (e.g. "Treasury Token ZA")
    /// @param symbol_        Token symbol (e.g. "TTZA")
    /// @param admin          Address granted all roles and initial supply
    /// @param initialSupply  Amount to mint to admin on deploy (in 2-decimal units)
    function initialize(
        string memory name_,
        string memory symbol_,
        address admin,
        uint256 initialSupply
    ) external initializer {
        if (admin == address(0)) revert ZeroAddress();

        __ERC20_init(name_, symbol_);
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);

        if (initialSupply > 0) {
            _mint(admin, initialSupply);
        }
    }

    // ── ERC20 overrides ───────────────────────────────────────────────────────

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    /// OZ v5 pattern: single hook replaces _beforeTokenTransfer + _afterTokenTransfer.
    /// Called by _mint, _burn, and _transfer.
    function _update(address from, address to, uint256 value) internal override {
        _requireNotPaused();

        // Blacklist: block sender on transfers/burns; block recipient on transfers/mints
        if (from != address(0) && blacklisted[from]) revert AccountBlacklisted(from);
        if (to   != address(0) && blacklisted[to])   revert AccountBlacklisted(to);

        // Whitelist (when enabled): applies to regular transfers only, not mint or burn
        if (whitelistEnabled && from != address(0) && to != address(0)) {
            if (!whitelisted[from]) revert AccountNotWhitelisted(from);
            if (!whitelisted[to])   revert AccountNotWhitelisted(to);
        }

        super._update(from, to, value);
    }

    // ── Mint / Burn ───────────────────────────────────────────────────────────

    /// @notice Mint tokens to a user after confirmed fiat deposit or voucher redemption.
    ///         Called by backend (MINTER_ROLE).
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0)      revert ZeroAmount();
        if (blacklisted[to])  revert AccountBlacklisted(to);
        _mint(to, amount);
        emit Minted(to, amount);
    }

    /// @notice Burn tokens from a user after remittance partner confirms settlement.
    ///         CRITICAL: backend must always call this — skipping causes token leak.
    ///         Called by backend (MINTER_ROLE).
    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0)        revert ZeroAmount();
        if (blacklisted[from])  revert AccountBlacklisted(from);
        _burn(from, amount);
        emit Burned(from, amount);
    }

    /// @notice Any holder may burn their own tokens.
    function burnOwn(uint256 amount) external nonReentrant {
        if (amount == 0)               revert ZeroAmount();
        if (blacklisted[msg.sender])   revert AccountBlacklisted(msg.sender);
        _burn(msg.sender, amount);
        emit Burned(msg.sender, amount);
    }

    // ── Pause ─────────────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ── Blacklist ─────────────────────────────────────────────────────────────

    function addToBlacklist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        blacklisted[account] = true;
        emit AddedToBlacklist(account);
    }

    function removeFromBlacklist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        blacklisted[account] = false;
        emit RemovedFromBlacklist(account);
    }

    // ── Whitelist ─────────────────────────────────────────────────────────────

    function addToWhitelist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        whitelisted[account] = true;
        emit AddedToWhitelist(account);
    }

    function removeFromWhitelist(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        whitelisted[account] = false;
        emit RemovedFromWhitelist(account);
    }

    /// @notice Enable or disable whitelist enforcement. Disabled by default.
    ///         When enabled, only whitelisted addresses may send or receive tokens.
    function setWhitelistEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistEnabled = enabled;
        emit WhitelistToggled(enabled);
    }

    // ── UUPS ──────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
