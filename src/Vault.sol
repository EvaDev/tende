// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable}            from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable}      from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable}          from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20}                   from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}                from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISwapRouterV3}  from "./interfaces/ISwapRouterV3.sol";
import {ITreasuryToken} from "./interfaces/ITreasuryToken.sol";
import {IConsumer}      from "./interfaces/IConsumer.sol";

/// @title Vault
/// @notice Unified balance ledger for all 1Remit currencies.
///         In POC mode adminCredit/adminDebit manage the ledger without moving tokens.
///         In production mode depositFromExternal / withdrawToExternal move real ERC20s.
///         Vault must hold MINTER_ROLE on every TreasuryToken it burns.
contract Vault is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    /// @notice Implementation version. Bump on every upgrade (constant, in bytecode).
    string public constant VERSION = "1.0.0";

    // ── Roles ─────────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_EXECUTOR_ROLE = keccak256("ADMIN_EXECUTOR_ROLE");
    /// Assigned to backend address for Phase 1; reassignable to a Settlement contract later.
    bytes32 public constant SETTLEMENT_ROLE     = keccak256("SETTLEMENT_ROLE");

    // ── Well-known currency codes ──────────────────────────────────────────────

    bytes32 public constant USDC_CODE = keccak256("USDC");

    // ── Custom errors ─────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error InvalidCurrency();
    error InsufficientBalance(address user, bytes32 currency, uint256 have, uint256 need);
    error InsufficientVaultTokenBalance(address token, uint256 have, uint256 need);
    error CountryMismatch(bytes32 senderCountry, bytes32 recipientCountry);
    error KycLevelInsufficient(address user, uint8 have, uint8 need);
    error RemittanceLocked(address user);
    error RemittanceNotLocked(address user);
    error TokenAlreadyRegistered(address token);
    error TokenNotSupported(address token);
    error DestinationNotAllowed(bytes32 destinationCode);

    // ── Core storage ──────────────────────────────────────────────────────────

    /// user → currencyCode → balance (in token units; 2 dec for ZAR, 6 dec for USDC)
    mapping(address => mapping(bytes32 => uint256)) public unifiedBalance;

    /// token address → currencyCode it backs
    mapping(address => bytes32) public tokenCurrency;

    /// Priority-ordered token list per currency (index 0 = highest priority)
    mapping(bytes32 => mapping(uint256 => address)) public currencyTokenAt;
    mapping(bytes32 => uint256) public currencyTokenCount;

    /// currencyCode → deployed TreasuryToken address (must hold MINTER_ROLE)
    mapping(bytes32 => address) public currencyTreasuryToken;

    /// Per-user remittance lock — set by startRemittance, cleared by payRemittance
    mapping(address => bool) public remittanceLocked;

    // ── External contract references ──────────────────────────────────────────

    IConsumer    public consumerContract;
    ISwapRouterV3 public swapRouter;
    address      public usdcToken;

    // ── Pilot: allowed remittance destination country codes ───────────────────

    mapping(bytes32 => bool) public isAllowedDestination;
    bytes32[] private _allowedDestinations;

    // ── Events ────────────────────────────────────────────────────────────────

    event Credited(address indexed user, bytes32 indexed currencyCode, uint256 amount, address indexed creditor);
    event Debited(address indexed user, bytes32 indexed currencyCode, uint256 amount);
    event Transferred(address indexed from, address indexed to, uint256 amount, bytes32 indexed currencyCode);
    event RemittanceStarted(address indexed user);
    event RemittanceSettled(address indexed from, uint256 amount, bytes32 indexed currencyCode, bytes32 destinationCountryCode);
    event Deposited(address indexed depositor, address indexed beneficiary, address token, uint256 amount);
    event Withdrawn(address indexed from, address indexed to, address token, uint256 amount);
    event UsdPurchased(address indexed buyer, uint256 localAmount, bytes32 indexed localCurrency, uint256 usdcReceived);
    event TokenRegistered(address indexed token, bytes32 indexed currencyCode);
    event TreasuryTokenSet(bytes32 indexed currencyCode, address indexed treasuryToken);
    event DestinationAdded(bytes32 indexed countryCode);
    event DestinationRemoved(bytes32 indexed countryCode);

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ── Initializer ───────────────────────────────────────────────────────────

    /// @param admin           Address granted DEFAULT_ADMIN_ROLE and ADMIN_EXECUTOR_ROLE
    /// @param swapRouter_     Uniswap V3 SwapRouter02 address for this network
    /// @param usdcToken_      USDC ERC20 address for this network
    function initialize(
        address admin,
        address swapRouter_,
        address usdcToken_
    ) external initializer {
        if (admin      == address(0)) revert ZeroAddress();
        if (swapRouter_ == address(0)) revert ZeroAddress();
        if (usdcToken_  == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE,   admin);
        _grantRole(ADMIN_EXECUTOR_ROLE,  admin);
        _grantRole(SETTLEMENT_ROLE,      admin);

        swapRouter = ISwapRouterV3(swapRouter_);
        usdcToken  = usdcToken_;

        // Pilot: ZW is the only allowed remittance destination
        _addAllowedDestination(keccak256("ZW"));
    }

    // ── Admin configuration ───────────────────────────────────────────────────

    /// @notice Register an ERC20 token as backing a currency code.
    ///         First token added per currency is highest priority for swaps.
    function addToken(address token, bytes32 currencyCode)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (token == address(0)) revert ZeroAddress();
        if (currencyCode == bytes32(0)) revert InvalidCurrency();
        if (tokenCurrency[token] != bytes32(0)) revert TokenAlreadyRegistered(token);

        tokenCurrency[token] = currencyCode;
        uint256 idx = currencyTokenCount[currencyCode];
        currencyTokenAt[currencyCode][idx] = token;
        currencyTokenCount[currencyCode] = idx + 1;

        emit TokenRegistered(token, currencyCode);
    }

    /// @notice Set the TreasuryToken contract for a currency.
    ///         Vault must hold MINTER_ROLE on the TreasuryToken.
    function setCurrencyTreasuryToken(bytes32 currencyCode, address treasuryToken)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (currencyCode == bytes32(0)) revert InvalidCurrency();
        if (treasuryToken == address(0)) revert ZeroAddress();
        currencyTreasuryToken[currencyCode] = treasuryToken;
        emit TreasuryTokenSet(currencyCode, treasuryToken);
    }

    /// @notice Set the Consumer contract reference for KYC and country checks.
    function setConsumerContract(address consumer)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (consumer == address(0)) revert ZeroAddress();
        consumerContract = IConsumer(consumer);
    }

    /// @notice Add a permitted remittance destination country (admin-expandable for post-pilot).
    function addAllowedDestination(bytes32 countryCode)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _addAllowedDestination(countryCode);
    }

    /// @notice Remove a remittance destination.
    function removeAllowedDestination(bytes32 countryCode)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (!isAllowedDestination[countryCode]) return;
        isAllowedDestination[countryCode] = false;
        uint256 len = _allowedDestinations.length;
        for (uint256 i = 0; i < len; ) {
            if (_allowedDestinations[i] == countryCode) {
                _allowedDestinations[i] = _allowedDestinations[len - 1];
                _allowedDestinations.pop();
                break;
            }
            unchecked { ++i; }
        }
        emit DestinationRemoved(countryCode);
    }

    // ── Credit / Debit (POC + admin flows) ───────────────────────────────────

    /// @notice Credit a user's balance without moving tokens.
    ///         Used for voucher redemption and bank deposit detection in POC mode.
    function adminCredit(address user, uint256 amount, bytes32 currencyCode)
        external
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (currencyCode == bytes32(0)) revert InvalidCurrency();

        unifiedBalance[user][currencyCode] += amount;
        emit Credited(user, currencyCode, amount, msg.sender);
    }

    /// @notice Debit a user's balance without moving tokens. Used for manual adjustments.
    function adminDebit(address user, uint256 amount, bytes32 currencyCode)
        external
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = unifiedBalance[user][currencyCode];
        if (bal < amount) revert InsufficientBalance(user, currencyCode, bal, amount);

        unifiedBalance[user][currencyCode] = bal - amount;
        emit Debited(user, currencyCode, amount);
    }

    /// @notice Internal credit callable by SETTLEMENT_ROLE (future Settlement contract).
    function credit(address user, uint256 amount, bytes32 currencyCode)
        external
        onlyRole(SETTLEMENT_ROLE)
    {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (currencyCode == bytes32(0)) revert InvalidCurrency();

        unifiedBalance[user][currencyCode] += amount;
        emit Credited(user, currencyCode, amount, msg.sender);
    }

    // ── P2P Transfer ──────────────────────────────────────────────────────────

    /// @notice Push payment from caller to `to`. Both parties must be registered
    ///         consumers and share the same country code (P2P is domestic only).
    ///         Called directly by a user's ERC-4337 Safe smart account.
    function transfer(address to, uint256 amount, bytes32 currencyCode)
        external
        nonReentrant
        whenNotPaused
    {
        address from = msg.sender;
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 bal = unifiedBalance[from][currencyCode];
        if (bal < amount) revert InsufficientBalance(from, currencyCode, bal, amount);

        // Country-match check: only enforced when Consumer contract is set and both are registered
        if (address(consumerContract) != address(0)) {
            bool fromRegistered = consumerContract.isRegistered(from);
            bool toRegistered   = consumerContract.isRegistered(to);
            if (fromRegistered && toRegistered) {
                bytes32 fromCountry = consumerContract.getCountryCode(from);
                bytes32 toCountry   = consumerContract.getCountryCode(to);
                if (fromCountry != toCountry) revert CountryMismatch(fromCountry, toCountry);
            }
        }

        // CEI: effects before any external interactions
        unifiedBalance[from][currencyCode] = bal - amount;
        unifiedBalance[to][currencyCode]  += amount;

        emit Transferred(from, to, amount, currencyCode);
    }

    // ── Remittance ────────────────────────────────────────────────────────────

    /// @notice Lock a user before initiating the off-ramp remittance flow.
    ///         Backend calls this before hitting the remittance partner API.
    ///         Prevents a second concurrent remittance for the same user.
    function startRemittance(address user)
        external
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (user == address(0)) revert ZeroAddress();
        if (remittanceLocked[user]) revert RemittanceLocked(user);

        // KYC gate: level 1 minimum
        if (address(consumerContract) != address(0)) {
            uint8 kyc = consumerContract.getKycLevel(user);
            if (kyc < 1) revert KycLevelInsufficient(user, kyc, 1);
        }

        remittanceLocked[user] = true;
        emit RemittanceStarted(user);
    }

    /// @notice Settle a confirmed remittance: deduct balance, burn TreasuryToken, clear lock.
    ///         Called by backend after remittance partner confirms payout.
    ///         CRITICAL: must always be called after partner confirms — skipping leaves user locked.
    /// @param from                    Consumer wallet whose balance is deducted
    /// @param amount                  Amount in currency units (2 dec for ZAR)
    /// @param currencyCode            Currency being sent
    /// @param destinationCountryCode  Pilot: must be keccak256("ZW") or an admin-added destination
    function payRemittance(
        address from,
        uint256 amount,
        bytes32 currencyCode,
        bytes32 destinationCountryCode
    )
        external
        nonReentrant
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (!remittanceLocked[from]) revert RemittanceNotLocked(from);
        if (amount == 0) revert ZeroAmount();
        if (!isAllowedDestination[destinationCountryCode]) revert DestinationNotAllowed(destinationCountryCode);

        uint256 bal = unifiedBalance[from][currencyCode];
        if (bal < amount) revert InsufficientBalance(from, currencyCode, bal, amount);

        // CEI: deduct balance and clear lock before external burn call
        unifiedBalance[from][currencyCode] = bal - amount;
        remittanceLocked[from] = false;

        // Burn corresponding TreasuryToken — must always succeed or whole tx reverts
        address tt = currencyTreasuryToken[currencyCode];
        if (tt != address(0)) {
            ITreasuryToken(tt).burn(from, amount);
        }

        emit RemittanceSettled(from, amount, currencyCode, destinationCountryCode);
    }

    // ── Production on-ramp / off-ramp ─────────────────────────────────────────

    /// @notice Pull ERC20 tokens from `depositor` into the vault and credit `beneficiary`.
    ///         Measures actual received amount to handle fee-on-transfer tokens.
    ///         Requires depositor to have pre-approved this contract.
    function depositFromExternal(
        address depositor,
        address beneficiary,
        address token,
        uint256 amount
    )
        external
        nonReentrant
        whenNotPaused
    {
        if (depositor   == address(0)) revert ZeroAddress();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (token       == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        bytes32 currencyCode = tokenCurrency[token];
        if (currencyCode == bytes32(0)) revert TokenNotSupported(token);

        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(depositor, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;

        unifiedBalance[beneficiary][currencyCode] += received;

        emit Deposited(depositor, beneficiary, token, received);
    }

    /// @notice Push ERC20 tokens out of the vault to `recipient`. Used for off-ramp.
    ///         CEI: deduct balance before external transfer.
    function withdrawToExternal(
        address from,
        address recipient,
        address token,
        uint256 amount
    )
        external
        nonReentrant
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (from      == address(0)) revert ZeroAddress();
        if (recipient == address(0)) revert ZeroAddress();
        if (token     == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        bytes32 currencyCode = tokenCurrency[token];
        if (currencyCode == bytes32(0)) revert TokenNotSupported(token);

        uint256 bal = unifiedBalance[from][currencyCode];
        if (bal < amount) revert InsufficientBalance(from, currencyCode, bal, amount);

        // CEI: deduct before external transfer
        unifiedBalance[from][currencyCode] = bal - amount;

        IERC20(token).safeTransfer(recipient, amount);

        emit Withdrawn(from, recipient, token, amount);
    }

    // ── USD Purchase (ZARP → USDC via Uniswap V3) ────────────────────────────

    /// @notice Swap local currency (e.g. ZARP) held by this vault for USDC, then
    ///         debit the buyer's local balance and credit their USDC balance.
    ///         Requires: vault holds sufficient localToken, buyer has sufficient balance,
    ///                   currencyTreasuryToken[localCurrency] is set.
    ///
    ///         No oracle — Uniswap execution price IS the rate (per project design).
    ///         Caller (backend) should preview with QuoterV2.quoteExactInputSingle and
    ///         pass a tight `minUsdcOut` to prevent sandwich attacks.
    ///
    /// @param buyer         Consumer wallet whose balance is debited/credited
    /// @param localAmount   Amount of local-currency tokens to sell (2 dec units for ZAR)
    /// @param localCurrency keccak256("ZAR") or equivalent
    /// @param poolFee       Uniswap V3 pool fee tier (e.g. 3000 = 0.30%)
    /// @param minUsdcOut    Minimum USDC out — revert if swap yields less (slippage guard)
    function purchaseUsd(
        address buyer,
        uint256 localAmount,
        bytes32 localCurrency,
        uint24  poolFee,
        uint256 minUsdcOut
    )
        external
        nonReentrant
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (buyer == address(0)) revert ZeroAddress();
        if (localAmount == 0)   revert ZeroAmount();
        if (localCurrency == bytes32(0)) revert InvalidCurrency();

        // Primary backing token for this currency (index 0 = highest priority)
        address localToken = currencyTokenAt[localCurrency][0];
        if (localToken == address(0)) revert InvalidCurrency();

        uint256 buyerBal = unifiedBalance[buyer][localCurrency];
        if (buyerBal < localAmount) revert InsufficientBalance(buyer, localCurrency, buyerBal, localAmount);

        uint256 vaultTokenBal = IERC20(localToken).balanceOf(address(this));
        if (vaultTokenBal < localAmount) revert InsufficientVaultTokenBalance(localToken, vaultTokenBal, localAmount);

        // CEI: deduct buyer's local balance before any external calls
        unifiedBalance[buyer][localCurrency] = buyerBal - localAmount;

        // Burn corresponding TreasuryToken from buyer
        address tt = currencyTreasuryToken[localCurrency];
        if (tt != address(0)) {
            ITreasuryToken(tt).burn(buyer, localAmount);
        }

        // Approve SwapRouter, execute swap, revoke approval
        IERC20(localToken).forceApprove(address(swapRouter), localAmount);

        uint256 usdcReceived = swapRouter.exactInputSingle(
            ISwapRouterV3.ExactInputSingleParams({
                tokenIn:           localToken,
                tokenOut:          usdcToken,
                fee:               poolFee,
                recipient:         address(this),
                amountIn:          localAmount,
                amountOutMinimum:  minUsdcOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Revoke residual approval
        IERC20(localToken).forceApprove(address(swapRouter), 0);

        // Credit buyer's USDC balance with actual received amount
        unifiedBalance[buyer][USDC_CODE] += usdcReceived;

        emit UsdPurchased(buyer, localAmount, localCurrency, usdcReceived);
    }

    // ── Pause ─────────────────────────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ── UUPS ──────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _addAllowedDestination(bytes32 countryCode) internal {
        if (countryCode == bytes32(0)) revert InvalidCurrency();
        if (isAllowedDestination[countryCode]) return;
        isAllowedDestination[countryCode] = true;
        _allowedDestinations.push(countryCode);
        emit DestinationAdded(countryCode);
    }
}
