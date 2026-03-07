// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IMorpho.sol";

/**
 * @title MockMorpho
 * @notice Simplified Morpho Blue mock for unit testing MorphoCredit
 * @dev Tracks collateral/borrows per onBehalf, handles real ERC-20 transfers.
 *      Implements authorization checks matching real Morpho Blue behavior:
 *      - borrow() and withdrawCollateral() require _isSenderAuthorized(onBehalf)
 *      - supplyCollateral() and repay() do NOT require authorization
 */
contract MockMorpho is IMorpho {
    using SafeERC20 for IERC20;

    // Per-user position tracking: user => collateral / borrow
    mapping(address => uint256) public collateralBalances;
    mapping(address => uint256) public borrowBalances;
    uint256 private _nextShareId = 1;

    // Authorization: authorizer => authorized => bool (matches Morpho Blue)
    mapping(address => mapping(address => bool)) private _isAuthorized;

    // ═══════════════════════════════════════════════════════════════════════
    //                          AUTHORIZATION
    // ═══════════════════════════════════════════════════════════════════════

    function setAuthorization(address authorized, bool newIsAuthorized) external override {
        _isAuthorized[msg.sender][authorized] = newIsAuthorized;
    }

    function isAuthorized(address authorizer, address authorized) external view override returns (bool) {
        return _isAuthorized[authorizer][authorized];
    }

    function _isSenderAuthorized(address onBehalf) internal view returns (bool) {
        return msg.sender == onBehalf || _isAuthorized[onBehalf][msg.sender];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                       COLLATERAL MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes memory /* data */
    ) external override {
        // Pull collateral from msg.sender (MorphoCredit contract)
        IERC20(marketParams.collateralToken).safeTransferFrom(msg.sender, address(this), assets);
        collateralBalances[onBehalf] += assets;
    }

    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        address receiver
    ) external override {
        require(_isSenderAuthorized(onBehalf), "MockMorpho: unauthorized");
        require(collateralBalances[onBehalf] >= assets, "MockMorpho: insufficient collateral");
        collateralBalances[onBehalf] -= assets;
        IERC20(marketParams.collateralToken).safeTransfer(receiver, assets);
    }

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 /* shares */,
        address onBehalf,
        address receiver
    ) external override returns (uint256 assetsBorrowed, uint256 sharesBorrowed) {
        require(_isSenderAuthorized(onBehalf), "MockMorpho: unauthorized");
        borrowBalances[onBehalf] += assets;
        // Transfer loan token to receiver
        IERC20(marketParams.loanToken).safeTransfer(receiver, assets);
        return (assets, _nextShareId++);
    }

    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 /* shares */,
        address onBehalf,
        bytes memory /* data */
    ) external override returns (uint256 assetsRepaid, uint256 sharesRepaid) {
        uint256 repayAmount = assets > borrowBalances[onBehalf] ? borrowBalances[onBehalf] : assets;
        borrowBalances[onBehalf] -= repayAmount;
        // Pull loan token from msg.sender (MorphoCredit contract)
        IERC20(marketParams.loanToken).safeTransferFrom(msg.sender, address(this), repayAmount);
        return (repayAmount, 1);
    }

    function position(
        bytes32 /* id */,
        address user
    ) external view override returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral) {
        return (0, uint128(borrowBalances[user]), uint128(collateralBalances[user]));
    }

    function market(
        bytes32 /* id */
    ) external view override returns (
        uint128 totalSupplyAssets,
        uint128 totalSupplyShares,
        uint128 totalBorrowAssets,
        uint128 totalBorrowShares,
        uint128 lastUpdate,
        uint128 fee
    ) {
        return (1_000_000e6, 1_000_000e6, 0, 0, uint128(block.timestamp), 0);
    }

    /// @notice Seed the mock with loan tokens so borrow() can transfer them out
    function seedLoanToken(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}
