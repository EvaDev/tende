// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable}            from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable}          from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {DataTypes}         from "./libraries/DataTypes.sol";
import {IConsumer}         from "./interfaces/IConsumer.sol";
import {ISafeProxyFactory} from "./interfaces/ISafeProxyFactory.sol";

/// @dev Minimal Safe interface — only the setup selector is needed for wallet initialisation.
interface ISafe {
    function setup(
        address[] calldata _owners,
        uint256 _threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
}

/// @title Consumer
/// @notice Account factory and identity registry for iMali.
///         Deploys one Safe v1.4.1 smart wallet per consumer.
///         Stores only the minimum identity data needed for onchain enforcement.
///         All PII (name, mobile, ID docs, ENS subdomain plaintext) lives in idOS.
///         Holds the append-only compliance remittance log (regulatory requirement).
///
///         Registration flow:
///           1. Backend resolves passkey signer via SafeWebAuthnSignerFactory
///           2. Backend calls registerConsumer() — deploys Safe, writes ConsumerData
///           3. Backend creates idOS profile anchored to the new wallet address
///           4. Backend writes ENS subdomain registration (offchain ENS call)
///           5. Backend whitelists the new wallet in Pimlico paymaster
///
///         Recovery flow (lost device):
///           1. User re-authenticates via idOS on new device
///           2. Backend reads ensSubdomain from idOS credential
///           3. Backend calls recoverWallet() — deploys new Safe, migrates ConsumerData
///           4. Backend re-registers ENS subdomain to new wallet
///           5. Backend updates idOS credential wallet_address field
contract Consumer is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient,
    IConsumer
{
    // ── Roles ─────────────────────────────────────────────────────────────────

    bytes32 public constant REGISTRAR_ROLE   = keccak256("REGISTRAR_ROLE");
    bytes32 public constant KYC_UPDATER_ROLE = keccak256("KYC_UPDATER_ROLE");
    bytes32 public constant RECORDER_ROLE    = keccak256("RECORDER_ROLE");

    // ── Custom errors ─────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error InvalidCountryCode();
    error InvalidKycLevel(uint8 level);
    error PilotCapReached(uint256 current, uint256 max);
    error EnsAlreadyRegistered(bytes32 ensHash);
    error EnsHashMismatch(bytes32 expected, bytes32 provided);
    error NotRegistered(address wallet);
    error KycLimitExceeded(address sender, uint256 attempted, uint256 dailyLimit);
    error WalletAlreadyHasSaveWallet(address wallet);
    error WalletAlreadyHasUsdWallet(address wallet);

    // ── Identity storage ──────────────────────────────────────────────────────

    mapping(address  => DataTypes.ConsumerData) private consumers;
    mapping(bytes32  => address) private ensByHash;
    mapping(uint256  => address) private consumerById;

    uint256 public consumerCount;
    uint256 public maxConsumers;
    uint256 private nextGlobalId;

    // ── Compliance log (append-only, regulatory) ──────────────────────────────

    DataTypes.RemittanceRecord[] public remittanceLog;

    /// KYC spend accumulators
    /// day bucket   = block.timestamp / 86400
    /// month bucket = block.timestamp / 2592000  (30-day approximation)
    mapping(address => mapping(uint256 => uint256)) public dailySent;
    mapping(address => mapping(uint256 => uint256)) public monthlySent;

    // ── Safe wallet deployment config ──────────────────────────────────────────

    /// Safe v1.4.1 singleton — 0x41675C099F32341bf84BFc5382aF534df5C7461a (all chains)
    address public safeSingleton;
    /// Safe v1.4.1 ProxyFactory — 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67 (all chains)
    address public safeProxyFactory;
    /// CompatibilityFallbackHandler — adds ERC-1271 to Safe; pass address(0) to skip
    address public safeFallbackHandler;

    // ── Events ────────────────────────────────────────────────────────────────

    event ConsumerRegistered(
        address indexed wallet,
        uint256 indexed globalId,
        bytes32         countryCode,
        uint8           kycLevel
    );
    event KycLevelUpdated(address indexed wallet, uint8 oldLevel, uint8 newLevel);
    event SaveWalletCreated(address indexed spendWallet, address indexed saveWallet);
    event UsdWalletCreated(address indexed spendWallet, address indexed usdWallet);

    /// @notice Emitted when a consumer recovers access after losing their passkey device.
    ///         oldWallet is deactivated but preserved for audit. ENS re-registration
    ///         and idOS credential update happen offchain after this event.
    event WalletRecovered(
        address indexed oldWallet,
        address indexed newWallet,
        uint256 indexed globalConsumerId
    );

    event RemittanceRecorded(
        address indexed sender,
        bytes32 indexed destinationCountryCode,
        uint256         amount,
        bytes32         partnerId,
        uint256         logIndex
    );
    event MaxConsumersUpdated(uint256 newMax);

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer ───────────────────────────────────────────────────────────

    /// @param admin                Address granted all admin roles
    /// @param safeSingleton_       Safe v1.4.1: 0x41675C099F32341bf84BFc5382aF534df5C7461a
    /// @param safeProxyFactory_    Safe v1.4.1: 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
    /// @param safeFallbackHandler_ CompatibilityFallbackHandler, or address(0) to skip
    function initialize(
        address admin,
        address safeSingleton_,
        address safeProxyFactory_,
        address safeFallbackHandler_
    ) external initializer {
        if (admin            == address(0)) revert ZeroAddress();
        if (safeSingleton_   == address(0)) revert ZeroAddress();
        if (safeProxyFactory_ == address(0)) revert ZeroAddress();

        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE,    admin);
        _grantRole(KYC_UPDATER_ROLE,  admin);
        _grantRole(RECORDER_ROLE,     admin);

        safeSingleton       = safeSingleton_;
        safeProxyFactory    = safeProxyFactory_;
        safeFallbackHandler = safeFallbackHandler_;

        maxConsumers = 500;   // pilot cap, admin-adjustable
        nextGlobalId = 1000;  // global IDs start at 1000
    }

    // ── Admin config ──────────────────────────────────────────────────────────

    function setMaxConsumers(uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxConsumers = newMax;
        emit MaxConsumersUpdated(newMax);
    }

    // ── Consumer registration ─────────────────────────────────────────────────

    /// @notice Deploy a Safe smart wallet and register a new consumer.
    ///
    ///         The backend must resolve the passkey signer address before calling:
    ///           1. Create WebAuthn credentials (device biometrics)
    ///           2. Call SafeWebAuthnSignerFactory.createSigner(pubKeyX, pubKeyY, verifiers)
    ///           3. Pass the returned signer address as `initialOwner` here
    ///           4. After this call: create idOS profile, register ENS, whitelist in Pimlico
    ///
    /// @param ensHash      keccak256(ensSubdomain); bytes32(0) if not yet assigned
    /// @param nameHash     keccak256(displayName) — plaintext kept in idOS only
    /// @param countryCode  e.g. keccak256("ZA") — used by Vault for P2P country matching
    /// @param kycLevel     Initial KYC level (always 0 for new registrations)
    /// @param initialOwner Passkey signer address — becomes sole Safe owner, threshold 1
    /// @return wallet      Address of the deployed Safe proxy
    function registerConsumer(
        bytes32 ensHash,
        bytes32 nameHash,
        bytes32 countryCode,
        uint8   kycLevel,
        address initialOwner
    )
        external
        nonReentrant
        onlyRole(REGISTRAR_ROLE)
        returns (address wallet)
    {
        if (consumerCount >= maxConsumers) revert PilotCapReached(consumerCount, maxConsumers);
        if (initialOwner  == address(0))   revert ZeroAddress();
        if (countryCode   == bytes32(0))   revert InvalidCountryCode();
        if (kycLevel > 3)                  revert InvalidKycLevel(kycLevel);
        if (ensHash != bytes32(0) && ensByHash[ensHash] != address(0)) {
            revert EnsAlreadyRegistered(ensHash);
        }

        uint256 id = nextGlobalId;
        unchecked { ++nextGlobalId; }

        // Salt derived from global ID — deterministic, non-replayable
        bytes32 salt = keccak256(abi.encodePacked(id));
        wallet = _deployConsumerWallet(salt, initialOwner);

        if (ensHash != bytes32(0)) ensByHash[ensHash] = wallet;
        consumerById[id] = wallet;

        consumers[wallet] = DataTypes.ConsumerData({
            spendWallet:      wallet,
            saveWallet:       address(0),
            usdWallet:        address(0),
            displayNameHash:  nameHash,
            ensSubdomainHash: ensHash,
            countryCode:      countryCode,
            kycLevel:         kycLevel,
            isActive:         true,
            globalConsumerId: id
        });

        unchecked { ++consumerCount; }

        emit ConsumerRegistered(wallet, id, countryCode, kycLevel);
    }

    // ── Wallet recovery ───────────────────────────────────────────────────────

    /// @notice Replace a consumer's Safe after losing their passkey device.
    ///
    ///         Prerequisites (all verified offchain by backend before calling):
    ///           1. User re-authenticated to idOS on new device
    ///           2. Backend retrieved ensSubdomain from idOS credential
    ///           3. Backend verified keccak256(ensSubdomain) == ensHash of old record
    ///           4. Backend resolved new passkey signer via SafeWebAuthnSignerFactory
    ///
    ///         After this call the backend must:
    ///           - Re-register ENS subdomain → newWallet
    ///           - Update idOS credential wallet_address field to newWallet
    ///           - Update DB consumers.wallet_address to newWallet
    ///           - Whitelist newWallet in Pimlico paymaster
    ///
    /// @param oldWallet  The original Safe address (deactivated, preserved for audit)
    /// @param ensHash    keccak256(ensSubdomain) — must match old record exactly
    /// @param newOwner   New passkey signer address from WebAuthn on replacement device
    /// @return newWallet Address of the newly deployed Safe proxy
    function recoverWallet(
        address oldWallet,
        bytes32 ensHash,
        address newOwner
    )
        external
        nonReentrant
        onlyRole(REGISTRAR_ROLE)
        returns (address newWallet)
    {
        if (newOwner == address(0)) revert ZeroAddress();
        if (ensHash  == bytes32(0)) revert InvalidCountryCode(); // reuse: "zero hash not allowed"

        DataTypes.ConsumerData storage old = consumers[oldWallet];
        if (!old.isActive) revert NotRegistered(oldWallet);

        // The provided ensHash must match what was registered for this wallet.
        // This is the offchain proof that the caller knows the subdomain.
        if (old.ensSubdomainHash != ensHash) revert EnsHashMismatch(old.ensSubdomainHash, ensHash);

        // Use globalConsumerId + block.timestamp for unique, non-replayable salt
        bytes32 salt = keccak256(abi.encodePacked(old.globalConsumerId, block.timestamp));
        newWallet = _deployConsumerWallet(salt, newOwner);

        // Migrate all data to new wallet address
        consumers[newWallet] = DataTypes.ConsumerData({
            spendWallet:      newWallet,
            saveWallet:       old.saveWallet,       // preserve existing save wallet link
            usdWallet:        old.usdWallet,         // preserve existing USD wallet link
            displayNameHash:  old.displayNameHash,
            ensSubdomainHash: ensHash,
            countryCode:      old.countryCode,
            kycLevel:         old.kycLevel,
            isActive:         true,
            globalConsumerId: old.globalConsumerId
        });

        // Deactivate old wallet — not deleted, preserved for compliance audit trail
        old.isActive = false;

        // Update all indexes to point to new wallet
        ensByHash[ensHash]                    = newWallet;
        consumerById[old.globalConsumerId]    = newWallet;

        emit WalletRecovered(oldWallet, newWallet, old.globalConsumerId);
    }

    // ── Secondary wallet creation ─────────────────────────────────────────────

    /// @notice Record the address of a consumer's newly created ZAR save wallet.
    ///         The save wallet itself is deployed by the backend (separate Safe).
    ///         Called after the save wallet Safe is deployed and Pimlico-whitelisted.
    function setSaveWallet(address spendWallet, address saveWallet)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        if (!consumers[spendWallet].isActive) revert NotRegistered(spendWallet);
        if (consumers[spendWallet].saveWallet != address(0)) {
            revert WalletAlreadyHasSaveWallet(spendWallet);
        }
        consumers[spendWallet].saveWallet = saveWallet;
        emit SaveWalletCreated(spendWallet, saveWallet);
    }

    /// @notice Record the address of a consumer's newly created USD savings wallet.
    ///         Requires kycLevel >= 2 (allows_usd_savings gate enforced in backend,
    ///         not repeated here to keep gas low — backend is the single enforcement point).
    function setUsdWallet(address spendWallet, address usdWallet)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        if (!consumers[spendWallet].isActive) revert NotRegistered(spendWallet);
        if (consumers[spendWallet].usdWallet != address(0)) {
            revert WalletAlreadyHasUsdWallet(spendWallet);
        }
        consumers[spendWallet].usdWallet = usdWallet;
        emit UsdWalletCreated(spendWallet, usdWallet);
    }

    // ── Lookup ────────────────────────────────────────────────────────────────

    function getConsumer(address wallet) external view returns (DataTypes.ConsumerData memory) {
        if (!consumers[wallet].isActive) revert NotRegistered(wallet);
        return consumers[wallet];
    }

    function getConsumerByEns(bytes32 ensHash) external view returns (DataTypes.ConsumerData memory) {
        address wallet = ensByHash[ensHash];
        if (wallet == address(0)) revert NotRegistered(address(0));
        return consumers[wallet];
    }

    function getConsumerByGlobalId(uint256 globalId) external view returns (DataTypes.ConsumerData memory) {
        address wallet = consumerById[globalId];
        if (wallet == address(0)) revert NotRegistered(address(0));
        return consumers[wallet];
    }

    // ── IConsumer (called by Vault for P2P and KYC gating) ────────────────────

    function isRegistered(address wallet) external view override returns (bool) {
        return consumers[wallet].isActive;
    }

    function isConsumer(address wallet) external view returns (bool) {
        return consumers[wallet].isActive;
    }

    function getCountryCode(address wallet) external view override returns (bytes32) {
        return consumers[wallet].countryCode;
    }

    function getKycLevel(address wallet) external view override returns (uint8) {
        return consumers[wallet].kycLevel;
    }

    // ── KYC management ────────────────────────────────────────────────────────

    /// @notice Update a consumer's KYC level after idOS credential verification.
    ///         Backend calls this after reading and verifying the idOS access grant.
    function updateKycLevel(address wallet, uint8 newLevel) external onlyRole(KYC_UPDATER_ROLE) {
        if (!consumers[wallet].isActive) revert NotRegistered(wallet);
        if (newLevel > 3) revert InvalidKycLevel(newLevel);
        uint8 old = consumers[wallet].kycLevel;
        consumers[wallet].kycLevel = newLevel;
        emit KycLevelUpdated(wallet, old, newLevel);
    }

    // ── KYC limits ────────────────────────────────────────────────────────────

    function checkKycLimit(address sender, uint256 amount) public view returns (bool) {
        if (amount == 0) return true;
        uint8 level = consumers[sender].kycLevel;
        if (level == 0) return false;

        uint256 dayBucket   = block.timestamp / 86400;
        uint256 monthBucket = block.timestamp / 2592000;

        uint256 projectedDaily   = dailySent[sender][dayBucket]   + amount;
        uint256 projectedMonthly = monthlySent[sender][monthBucket] + amount;

        if (level == 1) {
            return projectedDaily <= DataTypes.KYC1_DAILY
                && projectedMonthly <= DataTypes.KYC1_MONTHLY;
        }
        if (level == 2) {
            return projectedDaily <= DataTypes.KYC2_DAILY
                && projectedMonthly <= DataTypes.KYC2_MONTHLY;
        }
        return projectedDaily <= DataTypes.KYC3_DAILY
            && projectedMonthly <= DataTypes.KYC3_MONTHLY;
    }

    function getSentToday(address sender) external view returns (uint256) {
        return dailySent[sender][block.timestamp / 86400];
    }

    function getSentThisMonth(address sender) external view returns (uint256) {
        return monthlySent[sender][block.timestamp / 2592000];
    }

    // ── Compliance log ────────────────────────────────────────────────────────

    function recordRemittance(DataTypes.RemittanceRecord calldata record)
        external
        onlyRole(RECORDER_ROLE)
    {
        if (!consumers[record.sender].isActive) revert NotRegistered(record.sender);
        if (record.amountSent == 0) revert ZeroAmount();

        uint256 dayBucket   = block.timestamp / 86400;
        uint256 monthBucket = block.timestamp / 2592000;

        if (!checkKycLimit(record.sender, record.amountSent)) {
            uint256 projectedDaily = dailySent[record.sender][dayBucket] + record.amountSent;
            revert KycLimitExceeded(record.sender, record.amountSent, projectedDaily);
        }
        dailySent[record.sender][dayBucket]     += record.amountSent;
        monthlySent[record.sender][monthBucket] += record.amountSent;

        remittanceLog.push(record);
        uint256 logIdx = remittanceLog.length - 1;

        emit RemittanceRecorded(
            record.sender,
            record.destinationCountryCode,
            record.amountSent,
            record.partnerId,
            logIdx
        );
    }

    function remittanceLogLength() external view returns (uint256) {
        return remittanceLog.length;
    }

    // ── UUPS ──────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _deployConsumerWallet(bytes32 salt, address owner) internal returns (address) {
        address[] memory owners = new address[](1);
        owners[0] = owner;

        bytes memory initializer = abi.encodeWithSelector(
            ISafe.setup.selector,
            owners,
            uint256(1),
            address(0),
            bytes(""),
            safeFallbackHandler,
            address(0),
            uint256(0),
            address(0)
        );

        return ISafeProxyFactory(safeProxyFactory).createProxyWithNonce(
            safeSingleton,
            initializer,
            uint256(salt)
        );
    }
}
