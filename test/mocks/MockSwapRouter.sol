// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}        from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}     from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouterV3} from "../../src/interfaces/ISwapRouterV3.sol";

/// @dev Simulates a Uniswap V3 swap: pulls tokenIn from caller, pushes tokenOut to recipient.
///      Returns amountOutMinimum as amountOut.
///      Caller must seed this contract with tokenOut before swapping.
contract MockSwapRouter is ISwapRouterV3 {
    using SafeERC20 for IERC20;

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut)
    {
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountOutMinimum;
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
