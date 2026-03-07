// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IOracle.sol";

/**
 * @title MockOracle
 * @notice Mock Morpho oracle for testing
 * @dev Returns a configurable price scaled by 1e36 (ORACLE_PRICE_SCALE)
 *
 *      Example: WETH/USDC at $2500
 *        price = 2500 * 1e6 * 1e36 / 1e18 = 2500e24
 */
contract MockOracle is IOracle {
    uint256 private _price;

    constructor(uint256 price_) {
        _price = price_;
    }

    function price() external view override returns (uint256) {
        return _price;
    }

    function setPrice(uint256 newPrice) external {
        _price = newPrice;
    }
}
