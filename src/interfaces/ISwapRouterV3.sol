// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for Uniswap V3 SwapRouter02.
///         SwapRouter02 omits the `deadline` field present in the original SwapRouter.
///         Mainnet:  0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45 (verified via ethskills Mar 2026)
///         Sepolia:  0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48 (from project brief — verify before deploy)
interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut);
}
