// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {IConsumer} from "./interfaces/IConsumer.sol";

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
    /// @notice Implementation version. Bump on every upgrade (constant, in bytecode).
    /// 1.1.0 — adds ERC-3643-style controls: on-token KYC/jurisdiction gate via the
    ///         Consumer registry, partial freeze, and agent forcedTransfer (clawback).
    string public constant VERSION = "1.1.0";

    // ── Roles ─────────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Compliance operator: may freeze/unfreeze balances and force transfers
    ///         (clawback / lost-wallet recovery) and manage the trusted whitelist.
    ///         Held by the backend or a Safe. NOTE: this is a contract-operator role,
    ///         NOT a "cash-out agent" (which is a merchant/business participant).
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    // ── Custom errors ─────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error AccountBlacklisted(address account);
    error AccountNotWhitelisted(address account);
    // ── v1.1.0 compliance / freeze errors ──
    error SenderNotVerified(address account);
    error RecipientNotVerified(address account);
    error CrossBorderNotAllowed(bytes32 fromCountry, bytes32 toCountry);
    error InsufficientUnfrozenBalance(address account, uint256 available, uint256 needed);
    error FreezeExceedsBalance(address account, uint256 balance, uint256 requestedTotal);
    error AmountExceedsFrozen(address account, uint256 frozen, uint256 requested);

    // ── Access lists ──────────────────────────────────────────────────────────

    mapping(address => bool) public blacklisted;
    mapping(address => bool) public whitelisted;
    bool public whitelistEnabled;

    // ── Compliance + freeze (v1.1.0) ──────────────────────────────────────────
    // APPEND-ONLY: every variable below is declared AFTER all v1.0.0 state so the
    // UUPS proxy storage layout is preserved across the upgrade. Do NOT reorder.

    /// @notice Consumer registry used to gate peer transfers by KYC + country.
    ///         When unset, the consumer gate is inert regardless of complianceEnabled.
    IConsumer public consumerContract;

    /// @notice Master switch for the on-token KYC/jurisdiction gate. Off by default
    ///         so the upgrade is behaviour-preserving; turn ON in production to make
    ///         the token closed-loop (both parties must be same-country KYC'd consumers).
    bool public complianceEnabled;

    /// @notice account → tokens locked by a compliance agent. A holder may only move
    ///         (balanceOf - frozenTokens); privileged burn/forcedTransfer auto-unfreeze.
    mapping(address => uint256) public frozenTokens;

    /// @dev Transient guard (cleared within the same tx) marking an in-flight agent
    ///      forcedTransfer, so _update knows to bypass pause/blacklist/freeze/KYC for
    ///      that one privileged move. Stored (not `transient`) for solc 0.8.24 support.
    bool private _forcedTransferInProgress;

    // ── Events ────────────────────────────────────────────────────────────────

    event AddedToBlacklist(address indexed account);
    event RemovedFromBlacklist(address indexed account);
    event AddedToWhitelist(address indexed account);
    event RemovedFromWhitelist(address indexed account);
    event WhitelistToggled(bool enabled);
    event Minted(address indexed to, uint256 amount);
    event Burned(address indexed from, uint256 amount);
    // ── v1.1.0 compliance / freeze events ──
    event ConsumerContractSet(address indexed consumer);
    event ComplianceToggled(bool enabled);
    event TokensFrozen(address indexed account, uint256 amount);
    event TokensUnfrozen(address indexed account, uint256 amount);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount, address indexed agent);

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
        // COMPLIANCE_ROLE (freeze/forcedTransfer) for fresh deploys. NOTE: the already-
        // deployed v1.0.0 proxy will NOT re-run initialize on upgrade — there the
        // admin must call grantRole(COMPLIANCE_ROLE, operator) once after the v1.1.0 upgrade.
        _grantRole(COMPLIANCE_ROLE, admin);

        if (initialSupply > 0) {
            _mint(admin, initialSupply);
        }
    }

    // ── ERC20 overrides ───────────────────────────────────────────────────────

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    /// OZ v5 pattern: single hook replaces _beforeTokenTransfer + _afterTokenTransfer.
    /// Called by _mint (from==0), _burn (to==0), and _transfer (both non-zero).
    ///
    /// Gate summary:
    ///   - mint / burn      → privileged settlement; only pause + blacklist apply.
    ///   - peer transfer    → pause + blacklist + whitelist + (KYC/country) + freeze.
    ///   - forcedTransfer   → agent clawback/recovery; ALL gates bypassed for that
    ///                        single move (it sets _forcedTransferInProgress).
    function _update(address from, address to, uint256 value) internal override {
        bool forced = _forcedTransferInProgress;
        bool isPeerTransfer = from != address(0) && to != address(0);

        // A forced transfer is an emergency agent action (clawback / lost-key
        // recovery) and must work even against paused/blacklisted/frozen accounts,
        // so every gate below is skipped while `forced` is set.
        if (!forced) {
            _requireNotPaused();

            // Blacklist: block sender on transfers/burns; block recipient on transfers/mints
            if (from != address(0) && blacklisted[from]) revert AccountBlacklisted(from);
            if (to   != address(0) && blacklisted[to])   revert AccountBlacklisted(to);

            if (isPeerTransfer) {
                // Whitelist (when enabled): both parties must be explicitly allow-listed.
                if (whitelistEnabled) {
                    if (!whitelisted[from]) revert AccountNotWhitelisted(from);
                    if (!whitelisted[to])   revert AccountNotWhitelisted(to);
                }
                // ERC-3643-style on-token jurisdiction gate (when enabled).
                // Treasury tokens are COUNTRY-SPECIFIC (TTZA = ZA, TTZW = ZW) and
                // cannot cross borders: a peer transfer is allowed only between two
                // registered consumers in the SAME country, and needs NO KYC (it's a
                // domestic local-currency P2P). Cross-border value moves through the
                // Vault ledger / remittance flow, not by moving the treasury token.
                // Mint/burn are exempt (handled by the !forced / !isPeerTransfer split).
                if (complianceEnabled && address(consumerContract) != address(0)) {
                    _checkTreasuryCompliance(from, to);
                }
            }
        }

        // Frozen-balance enforcement (skipped for mint: from==0).
        if (from != address(0)) {
            uint256 frozen = frozenTokens[from];
            if (frozen != 0) {
                if (isPeerTransfer && !forced) {
                    // A holder may move only their unfrozen balance.
                    uint256 available = balanceOf(from) - frozen; // invariant: balanceOf >= frozen
                    if (value > available) revert InsufficientUnfrozenBalance(from, available, value);
                } else {
                    // Privileged outflow (burn or forcedTransfer): auto-unfreeze any
                    // portion that would otherwise exceed the post-outflow balance,
                    // keeping the balanceOf >= frozenTokens invariant intact.
                    uint256 remaining = balanceOf(from) - value; // _burn/_transfer guarantee value<=balance
                    if (frozen > remaining) {
                        frozenTokens[from] = remaining;
                        emit TokensUnfrozen(from, frozen - remaining);
                    }
                }
            }
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

    /// @notice Mark `account` as a trusted address. Doubles as: (a) the hard
    ///         allow-list when whitelistEnabled is on, and (b) the platform/merchant
    ///         "trusted settlement" set that is exempt from the consumer/country gate
    ///         when complianceEnabled is on. Managed by COMPLIANCE_ROLE so the backend can
    ///         whitelist merchant wallets during onboarding.
    function addToWhitelist(address account) external onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        whitelisted[account] = true;
        emit AddedToWhitelist(account);
    }

    function removeFromWhitelist(address account) external onlyRole(COMPLIANCE_ROLE) {
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

    // ── Compliance configuration (v1.1.0) ─────────────────────────────────────

    /// @notice Point the token at the Consumer registry used for the KYC/country gate.
    function setConsumerContract(address consumer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (consumer == address(0)) revert ZeroAddress();
        consumerContract = IConsumer(consumer);
        emit ConsumerContractSet(consumer);
    }

    /// @notice Enable/disable the on-token KYC + jurisdiction gate on peer transfers.
    ///         Off by default (behaviour-preserving upgrade). Set the Consumer contract
    ///         first, then enable, to make TT closed-loop between KYC'd same-country wallets.
    function setComplianceEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        complianceEnabled = enabled;
        emit ComplianceToggled(enabled);
    }

    // ── Freeze (partial) ──────────────────────────────────────────────────────

    /// @notice Lock `amount` of `account`'s balance so it cannot be transferred.
    ///         Cumulative; total frozen may not exceed the account's balance.
    ///         Privileged burn/forcedTransfer can still move frozen tokens.
    function freezePartialTokens(address account, uint256 amount) external onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 newFrozen = frozenTokens[account] + amount;
        if (newFrozen > balanceOf(account)) revert FreezeExceedsBalance(account, balanceOf(account), newFrozen);
        frozenTokens[account] = newFrozen;
        emit TokensFrozen(account, amount);
    }

    /// @notice Release `amount` of previously frozen tokens on `account`.
    function unfreezePartialTokens(address account, uint256 amount) external onlyRole(COMPLIANCE_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 frozen = frozenTokens[account];
        if (amount > frozen) revert AmountExceedsFrozen(account, frozen, amount);
        frozenTokens[account] = frozen - amount;
        emit TokensUnfrozen(account, amount);
    }

    // ── Forced transfer (clawback / recovery) ─────────────────────────────────

    /// @notice Agent-only forced move of `amount` from `from` to `to`, bypassing
    ///         pause, blacklist, whitelist, the KYC/country gate, and freeze. Use for
    ///         AML clawback or recovering tokens from a lost passkey-Safe wallet into
    ///         a fresh one. Emitted as ForcedTransfer for off-chain audit/compliance.
    function forcedTransfer(address from, address to, uint256 amount)
        external
        onlyRole(COMPLIANCE_ROLE)
        nonReentrant
    {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        // Set the bypass flag for the single _update this _transfer triggers, then
        // clear it unconditionally so it can never leak into a later call.
        _forcedTransferInProgress = true;
        _transfer(from, to, amount);
        _forcedTransferInProgress = false;

        emit ForcedTransfer(from, to, amount, msg.sender);
    }

    // ── Internal: treasury-token KYC / jurisdiction gate ───────────────────────

    /// @dev Treasury-token transfer policy (enforced only when complianceEnabled
    ///      and a Consumer registry is set). TT holders are exactly: consumers, the
    ///      platform treasury, and merchants who accept TT as settlement.
    ///        • Each party must be EITHER a registered consumer OR a whitelisted
    ///          "trusted" address. The whitelist is the platform + merchant allow-
    ///          list (see addToWhitelist); they are not Consumer-registered.
    ///        • When BOTH parties are consumers, the transfer must be DOMESTIC
    ///          (same country) — the treasury token is country-specific and cannot
    ///          cross borders. NO KYC level is required for that domestic P2P.
    ///        • Any leg involving a trusted address (consumer→merchant settlement,
    ///          platform top-ups, etc.) skips the country check — trusted endpoints
    ///          are country-agnostic.
    ///      Cross-border value movement is a Vault-ledger concern (both-KYC'd),
    ///      never a treasury-token transfer.
    function _checkTreasuryCompliance(address from, address to) internal view {
        IConsumer c = consumerContract;

        bool fromTrusted = whitelisted[from]; // platform / merchant settlement address
        bool toTrusted   = whitelisted[to];

        if (!fromTrusted && !c.isRegistered(from)) revert SenderNotVerified(from);
        if (!toTrusted   && !c.isRegistered(to))   revert RecipientNotVerified(to);

        // Same-country rule applies only between two consumers; a trusted endpoint
        // on either side is exempt.
        if (!fromTrusted && !toTrusted) {
            bytes32 fromCountry = c.getCountryCode(from);
            bytes32 toCountry   = c.getCountryCode(to);
            if (fromCountry != toCountry) revert CrossBorderNotAllowed(fromCountry, toCountry);
        }
    }

    // ── UUPS ──────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
