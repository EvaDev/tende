// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal Safe surface — module calls execTransactionFromModule so Vault sees msg.sender = Safe.
interface ISafeModule {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    ) external returns (bool success);
}

interface IVaultTransfer {
    function transfer(address to, uint256 amount, bytes32 currencyCode) external;
}

/// @title SessionTransferModule
/// @notice Safe module that lets a short-lived secp256k1 session key authorize Vault.transfer
///         without re-running on-chain WebAuthn/P-256 verification on every payment.
///         The passkey owner registers session keys via Safe.execTransaction → addSessionKey;
///         the platform relay calls executeTransfer with the session EOA signature.
contract SessionTransferModule is ReentrancyGuard {
    using ECDSA for bytes32;

    // ── Errors ────────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error SessionInactive(address safe, address sessionKey);
    error SessionExpired(address safe, address sessionKey);
    error DeadlineExpired();
    error AmountExceedsCap(uint256 amount, uint256 maxPerTx);
    error DailyCapExceeded(uint256 projected, uint256 dailyCap);
    error InvalidSessionSignature();
    error VaultTransferFailed();

    // ── Types ─────────────────────────────────────────────────────────────────

    struct Session {
        uint64  expiry;
        uint256 maxPerTx;
        uint256 dailyCap;
        uint256 dailySpent;
        uint256 dayBucket;
        uint256 nonce;
        bool    active;
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    address public immutable vault;

    /// safe => sessionKey => session config
    mapping(address => mapping(address => Session)) public sessions;

    bytes32 public constant SESSION_TRANSFER_TYPEHASH = keccak256(
        "SessionTransfer(address safe,address to,uint256 amount,bytes32 currencyCode,uint256 nonce,uint256 deadline)"
    );

    // ── Events ────────────────────────────────────────────────────────────────

    event SessionKeyAdded(
        address indexed safe,
        address indexed sessionKey,
        uint64 expiry,
        uint256 maxPerTx,
        uint256 dailyCap
    );
    event SessionKeyRemoved(address indexed safe, address indexed sessionKey);
    event SessionTransferExecuted(
        address indexed safe,
        address indexed sessionKey,
        address indexed to,
        uint256 amount,
        bytes32 currencyCode
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address vault_) {
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
    }

    // ── Session management (called by Safe via execTransaction) ───────────────

    /// @notice Register a session key. `msg.sender` must be the consumer Safe.
    function addSessionKey(
        address sessionKey,
        uint64 expiry,
        uint256 maxPerTx,
        uint256 dailyCap
    ) external {
        address safe = msg.sender;
        if (sessionKey == address(0)) revert ZeroAddress();
        if (expiry <= block.timestamp) revert SessionExpired(safe, sessionKey);

        sessions[safe][sessionKey] = Session({
            expiry:     expiry,
            maxPerTx:   maxPerTx,
            dailyCap:   dailyCap,
            dailySpent: 0,
            dayBucket:  0,
            nonce:      0,
            active:     true
        });

        emit SessionKeyAdded(safe, sessionKey, expiry, maxPerTx, dailyCap);
    }

    /// @notice Revoke a session key. `msg.sender` must be the consumer Safe.
    function removeSessionKey(address sessionKey) external {
        address safe = msg.sender;
        delete sessions[safe][sessionKey];
        emit SessionKeyRemoved(safe, sessionKey);
    }

    // ── Relay path (session EOA signature) ────────────────────────────────────

    /// @notice Execute Vault.transfer from `safe` after validating a session-key signature.
    ///         Callable by anyone (platform relay). Caps and expiry enforced on-chain.
    function executeTransfer(
        address safe,
        address sessionKey,
        address to,
        uint256 amount,
        bytes32 currencyCode,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (bool) {
        _validateAndConsumeSession(safe, sessionKey, to, amount, currencyCode, deadline, signature);
        bytes memory data = abi.encodeCall(IVaultTransfer.transfer, (to, amount, currencyCode));
        if (!ISafeModule(safe).execTransactionFromModule(vault, 0, data, 0)) revert VaultTransferFailed();
        emit SessionTransferExecuted(safe, sessionKey, to, amount, currencyCode);
        return true;
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function sessionTransferHash(
        address safe,
        address sessionKey,
        address to,
        uint256 amount,
        bytes32 currencyCode,
        uint256 deadline
    ) external view returns (bytes32) {
        Session storage sess = sessions[safe][sessionKey];
        bytes32 structHash = keccak256(abi.encode(
            SESSION_TRANSFER_TYPEHASH,
            safe,
            to,
            amount,
            currencyCode,
            sess.nonce,
            deadline
        ));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function getSession(address safe, address sessionKey) external view returns (Session memory) {
        return sessions[safe][sessionKey];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _validateAndConsumeSession(
        address safe,
        address sessionKey,
        address to,
        uint256 amount,
        bytes32 currencyCode,
        uint256 deadline,
        bytes calldata signature
    ) internal {
        if (to == address(0) || sessionKey == address(0) || safe == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        Session storage sess = sessions[safe][sessionKey];
        if (!sess.active) revert SessionInactive(safe, sessionKey);
        if (block.timestamp > sess.expiry) revert SessionExpired(safe, sessionKey);
        if (amount > sess.maxPerTx) revert AmountExceedsCap(amount, sess.maxPerTx);

        uint256 day = block.timestamp / 86400;
        if (sess.dayBucket != day) {
            sess.dayBucket = day;
            sess.dailySpent = 0;
        }
        uint256 projected = sess.dailySpent + amount;
        if (projected > sess.dailyCap) revert DailyCapExceeded(projected, sess.dailyCap);

        bytes32 structHash = keccak256(abi.encode(
            SESSION_TRANSFER_TYPEHASH,
            safe,
            to,
            amount,
            currencyCode,
            sess.nonce,
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        if (digest.recover(signature) != sessionKey) revert InvalidSessionSignature();

        unchecked {
            ++sess.nonce;
            sess.dailySpent = projected;
        }
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("iMali SessionTransfer"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }
}
