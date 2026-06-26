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
    /// 1.1.0 — ERC-4626-style share ledger + yield harvesting via price-per-share.
    string public constant VERSION = "1.1.0";

    /// @notice Basis-points denominator (100% = 10_000).
    uint16 public constant BPS_DENOMINATOR = 10_000;

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
    error KycLevelInsufficient(address user, uint8 have, uint8 need);
    error RemittanceLocked(address user);
    error RemittanceNotLocked(address user);
    error TokenAlreadyRegistered(address token);
    error TokenNotSupported(address token);
    error DestinationNotAllowed(bytes32 destinationCode);
    error FeeTooHigh(uint16 bps);
    error NoYield(bytes32 currencyCode);

    // ── Core storage ──────────────────────────────────────────────────────────

    /// user → currencyCode → SHARES held. Asset value = convertToAssets(shares).
    /// SLOT-COMPATIBLE with the v1.0.0 `unifiedBalance` mapping it replaces (same
    /// type & position); safe to reinterpret because all balances are zero at the
    /// time of the v1.1.0 upgrade. Read asset balances via unifiedBalance(user,cur).
    mapping(address => mapping(bytes32 => uint256)) private _shares;

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

    // ── Share ledger (v1.1.0) ─────────────────────────────────────────────────
    // APPEND-ONLY: declared after every pre-existing state variable so the UUPS
    // proxy storage layout is preserved across the upgrade. Do NOT reorder.

    /// currencyCode → total shares issued. Bootstraps 1:1 with assets on first credit.
    mapping(bytes32 => uint256) public totalShares;

    /// currencyCode → recorded asset backing (ERC-4626 "total assets"). Grows on
    /// credit/deposit, shrinks on debit/withdraw/swap-out. harvest() raises this
    /// by the user share of accrued yield, which lifts price-per-share for every
    /// holder at once — no per-user crediting needed. Harvestable yield is the gap
    /// between actual backing-token holdings and this figure.
    mapping(bytes32 => uint256) public totalAssets;

    /// Trusted counterparties (merchants, platform treasury) — KYB-verified
    /// endpoints that are exempt from the consumer-KYC requirement on transfer().
    /// A merchant is registered here at onboarding so consumers can pay it (e.g. in
    /// USDC) without the merchant being a registered consumer. APPEND-ONLY.
    mapping(address => bool) public trustedCounterparty;

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
    event YieldHarvested(bytes32 indexed currencyCode, uint256 yieldDelta, uint256 platformCut, uint256 userYield, address indexed treasury);
    event TotalAssetsReconciled(bytes32 indexed currencyCode, uint256 oldValue, uint256 newValue);
    event TrustedCounterpartySet(address indexed account, bool trusted);

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

    /// @notice Mark `account` as a trusted counterparty (merchant / platform
    ///         treasury), exempt from the consumer-KYC requirement in transfer().
    ///         Called by the backend at merchant onboarding. ADMIN_EXECUTOR_ROLE
    ///         (the backend already holds it) — no separate agent role on the Vault.
    function setTrustedCounterparty(address account, bool trusted)
        external
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (account == address(0)) revert ZeroAddress();
        trustedCounterparty[account] = trusted;
        emit TrustedCounterpartySet(account, trusted);
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

        _creditAssets(user, currencyCode, amount);
        emit Credited(user, currencyCode, amount, msg.sender);
    }

    /// @notice Debit a user's balance without moving tokens. Used for manual adjustments.
    function adminDebit(address user, uint256 amount, bytes32 currencyCode)
        external
        onlyRole(ADMIN_EXECUTOR_ROLE)
    {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _debitAssets(user, currencyCode, amount);
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

        _creditAssets(user, currencyCode, amount);
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

        uint256 fromShares = _shares[from][currencyCode];
        uint256 bal = _convertToAssets(currencyCode, fromShares, false);
        if (bal < amount) revert InsufficientBalance(from, currencyCode, bal, amount);

        // Compliance: Vault balances (unified / tradeable / USD) MAY cross borders
        // — unlike the country-specific TreasuryToken — but every party must be
        // verified. Each side must be EITHER a KYC'd consumer (level >= 1) OR a
        // trusted counterparty (merchant / platform treasury — KYB-verified, so a
        // consumer can pay a merchant without the merchant being a consumer).
        // getKycLevel returns 0 for unregistered wallets, so a non-consumer that is
        // not trusted is rejected. Enforced only when a Consumer is set.
        if (address(consumerContract) != address(0)) {
            if (!trustedCounterparty[from]) {
                uint8 fromKyc = consumerContract.getKycLevel(from);
                if (fromKyc < 1) revert KycLevelInsufficient(from, fromKyc, 1);
            }
            if (!trustedCounterparty[to]) {
                uint8 toKyc = consumerContract.getKycLevel(to);
                if (toKyc < 1) revert KycLevelInsufficient(to, toKyc, 1);
            }
        }

        // Move shares (not assets) so totalShares/totalAssets are unchanged.
        // Round up the shares to move, capped at sender's balance (handles the
        // exact-full-balance case without leaving 1-wei share dust stranded).
        uint256 moveShares = _convertToShares(currencyCode, amount, true);
        if (moveShares > fromShares) moveShares = fromShares;

        // CEI: effects before any external interactions
        _shares[from][currencyCode] = fromShares - moveShares;
        _shares[to][currencyCode]  += moveShares;

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

        // CEI: deduct balance and clear lock before external burn call
        _debitAssets(from, currencyCode, amount);
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

        _creditAssets(beneficiary, currencyCode, received);

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

        // CEI: deduct (burns shares + reduces recorded assets) before external transfer
        _debitAssets(from, currencyCode, amount);

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

        uint256 vaultTokenBal = IERC20(localToken).balanceOf(address(this));
        if (vaultTokenBal < localAmount) revert InsufficientVaultTokenBalance(localToken, vaultTokenBal, localAmount);

        // CEI: deduct buyer's local balance before any external calls. _debitAssets
        // burns shares and reduces recorded assets (the local backing token is
        // about to leave the vault via the swap).
        _debitAssets(buyer, localCurrency, localAmount);

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

        // Credit buyer's USDC balance with actual received amount. The USDC now
        // sits in the vault as backing for USDC_CODE — record it so harvest()
        // does not mistake swapped-in USDC for yield.
        _creditAssets(buyer, USDC_CODE, usdcReceived);

        emit UsdPurchased(buyer, localAmount, localCurrency, usdcReceived);
    }

    // ── Share-ledger views (ERC-4626 semantics) ──────────────────────────────

    /// @notice A user's spendable balance in asset units. ABI-compatible with the
    ///         v1.0.0 `unifiedBalance` getter; now derived from shares × price.
    function unifiedBalance(address user, bytes32 currencyCode) public view returns (uint256) {
        return _convertToAssets(currencyCode, _shares[user][currencyCode], false);
    }

    /// @notice A user's raw share count for a currency.
    function sharesOf(address user, bytes32 currencyCode) external view returns (uint256) {
        return _shares[user][currencyCode];
    }

    /// @notice Assets one would receive for `shares` (round down).
    function convertToAssets(bytes32 currencyCode, uint256 shares) external view returns (uint256) {
        return _convertToAssets(currencyCode, shares, false);
    }

    /// @notice Shares one would receive for depositing `assets` (round down).
    function convertToShares(bytes32 currencyCode, uint256 assets) external view returns (uint256) {
        return _convertToShares(currencyCode, assets, false);
    }

    /// @notice Price per 1e18 shares, in asset units. 1e18 before any deposit.
    function pricePerShare(bytes32 currencyCode) external view returns (uint256) {
        return _convertToAssets(currencyCode, 1e18, false);
    }

    // ── Yield harvesting ──────────────────────────────────────────────────────

    /// @notice View the currently harvestable yield for a currency: the gap
    ///         between the vault's *actual* backing-token holdings and the
    ///         recorded `totalAssets`. Returns 0 if holdings <= recorded.
    /// @dev    Safe to call by anyone; pure read. The backend uses this to decide
    ///         whether a harvest() is worth the gas before scheduling one.
    function harvestableYield(bytes32 currencyCode) public view returns (uint256) {
        uint256 actual = _actualHoldings(currencyCode);
        uint256 recorded = totalAssets[currencyCode];
        return actual > recorded ? actual - recorded : 0;
    }

    /// @notice Harvest accrued yield for a currency. Sweeps the platform's cut to
    ///         the treasury as real tokens; the user portion accrues to holders
    ///         automatically by raising price-per-share — NO per-user crediting.
    ///
    ///         Yield = (actual backing-token holdings) − (recorded totalAssets).
    ///         platformCut → treasuryAddress as real tokens. The user portion is
    ///         added to totalAssets WITHOUT minting shares, so every holder's
    ///         convertToAssets(shares) rises pro-rata in one O(1) write (ERC-4626).
    ///
    ///         No baseline seeding is needed when upgraded with empty vaults:
    ///         totalAssets starts at 0 and only ever tracks credited deposits.
    ///
    /// @param currencyCode    Currency to harvest (e.g. keccak256("USDC"))
    /// @param treasuryAddress Recipient of the platform's cut (real tokens)
    /// @param platformFeeBps  Platform share of the yield, in basis points (<= 10_000)
    /// @return userYield      Asset amount distributed to holders via price-per-share
    function harvest(bytes32 currencyCode, address treasuryAddress, uint16 platformFeeBps)
        external
        nonReentrant
        onlyRole(ADMIN_EXECUTOR_ROLE)
        returns (uint256 userYield)
    {
        if (treasuryAddress == address(0)) revert ZeroAddress();
        if (platformFeeBps > BPS_DENOMINATOR) revert FeeTooHigh(platformFeeBps);

        uint256 actualHoldings = _actualHoldings(currencyCode);
        uint256 recorded = totalAssets[currencyCode];
        if (actualHoldings <= recorded) revert NoYield(currencyCode);

        uint256 yieldDelta  = actualHoldings - recorded;
        uint256 platformCut = (yieldDelta * platformFeeBps) / BPS_DENOMINATOR;
        userYield           = yieldDelta - platformCut;

        // Raise recorded assets by the user portion only. With totalShares
        // unchanged, this lifts price-per-share for every holder at once. After
        // the sweep below, totalAssets == actual holdings again (no re-harvest).
        totalAssets[currencyCode] = recorded + userYield;

        // Sweep the platform's cut out as real tokens, drawn from the primary
        // backing token (index 0). For single-backing-token currencies (the pilot
        // reality) this is exactly where the yield accrued; safeTransfer reverts
        // if that token can't cover the cut.
        if (platformCut > 0) {
            address primaryToken = currencyTokenAt[currencyCode][0];
            if (primaryToken == address(0)) revert InvalidCurrency();
            IERC20(primaryToken).safeTransfer(treasuryAddress, platformCut);
        }

        emit YieldHarvested(currencyCode, yieldDelta, platformCut, userYield, treasuryAddress);
    }

    /// @notice Emergency correction of recorded assets for a currency (drift repair).
    ///         WARNING: directly rescales price-per-share, hence every holder's
    ///         balance — DEFAULT_ADMIN_ROLE only. Not needed in normal operation
    ///         when the vault was upgraded empty (totalAssets self-tracks).
    function reconcileTotalAssets(bytes32 currencyCode, uint256 newTotal)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (currencyCode == bytes32(0)) revert InvalidCurrency();
        uint256 old = totalAssets[currencyCode];
        totalAssets[currencyCode] = newTotal;
        emit TotalAssetsReconciled(currencyCode, old, newTotal);
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

    /// @dev Sum the vault's actual balance across every backing token registered
    ///      for a currency. For plain and rebasing ERC20s balanceOf is sufficient;
    ///      a revaluing/share token would need its own exchange rate applied here.
    function _actualHoldings(bytes32 currencyCode) internal view returns (uint256 total) {
        uint256 count = currencyTokenCount[currencyCode];
        for (uint256 i = 0; i < count; ) {
            total += IERC20(currencyTokenAt[currencyCode][i]).balanceOf(address(this));
            unchecked { ++i; }
        }
    }

    /// @dev Convert assets → shares. Bootstraps 1:1 while the pool is empty.
    ///      Not vulnerable to the classic ERC-4626 inflation attack: totalAssets
    ///      is tracked explicitly (credited amounts), never read from balanceOf,
    ///      so a direct token donation cannot move price until an admin harvest.
    function _convertToShares(bytes32 currencyCode, uint256 assets, bool roundUp)
        internal
        view
        returns (uint256 shares)
    {
        uint256 ts = totalShares[currencyCode];
        uint256 ta = totalAssets[currencyCode];
        if (ts == 0 || ta == 0) return assets; // 1:1 bootstrap
        shares = (assets * ts) / ta;
        if (roundUp && mulmod(assets, ts, ta) != 0) shares += 1;
    }

    /// @dev Convert shares → assets. Returns 0 before any shares exist.
    function _convertToAssets(bytes32 currencyCode, uint256 shares, bool roundUp)
        internal
        view
        returns (uint256 assets)
    {
        uint256 ts = totalShares[currencyCode];
        if (ts == 0) return 0;
        uint256 ta = totalAssets[currencyCode];
        assets = (shares * ta) / ts;
        if (roundUp && mulmod(shares, ta, ts) != 0) assets += 1;
    }

    /// @dev Mint shares for `assets` credited to `user` and grow recorded assets.
    ///      Round shares DOWN so existing holders are never diluted by a credit.
    function _creditAssets(address user, bytes32 currencyCode, uint256 assets) internal {
        uint256 newShares = _convertToShares(currencyCode, assets, false);
        _shares[user][currencyCode] += newShares;
        totalShares[currencyCode]   += newShares;
        totalAssets[currencyCode]   += assets;
    }

    /// @dev Burn the shares backing `assets` from `user` and shrink recorded assets.
    ///      Reverts if the user's asset balance is below `assets`. Round shares to
    ///      burn UP (so a user can't extract more value than they give up), capped
    ///      at their share balance to clear dust on a full-balance withdrawal.
    function _debitAssets(address user, bytes32 currencyCode, uint256 assets) internal {
        uint256 userShares = _shares[user][currencyCode];
        uint256 bal = _convertToAssets(currencyCode, userShares, false);
        if (bal < assets) revert InsufficientBalance(user, currencyCode, bal, assets);

        uint256 burnShares = (assets == bal)
            ? userShares                                          // full exit: burn all
            : _convertToShares(currencyCode, assets, true);       // partial: round up
        if (burnShares > userShares) burnShares = userShares;     // never underflow

        _shares[user][currencyCode] = userShares - burnShares;
        totalShares[currencyCode]  -= burnShares;
        totalAssets[currencyCode]  -= assets;
    }

    function _addAllowedDestination(bytes32 countryCode) internal {
        if (countryCode == bytes32(0)) revert InvalidCurrency();
        if (isAllowedDestination[countryCode]) return;
        isAllowedDestination[countryCode] = true;
        _allowedDestinations.push(countryCode);
        emit DestinationAdded(countryCode);
    }
}
