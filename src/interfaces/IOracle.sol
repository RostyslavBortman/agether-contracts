// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IOracle
 * @notice Morpho Blue oracle interface
 * @dev Oracle.price() returns the price of 1 asset of collateral token quoted in
 *      1 asset of loan token, scaled by 1e36.
 *
 *      For example, for WETH (18 dec) / USDC (6 dec) at $2500:
 *        price = 2500 * 1e6 * 1e36 / 1e18 = 2500e24
 *
 *      Morpho Blue uses: collateralValue = collateral * price / ORACLE_PRICE_SCALE
 *      where ORACLE_PRICE_SCALE = 1e36.
 */
interface IOracle {
    function price() external view returns (uint256);
}
