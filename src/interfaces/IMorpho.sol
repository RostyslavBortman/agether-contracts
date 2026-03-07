// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMorpho
 * @notice Minimal Morpho Blue interface
 */
interface IMorpho {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes memory data
    ) external;

    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        address receiver
    ) external;

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);

    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes memory data
    ) external returns (uint256 assetsRepaid, uint256 sharesRepaid);

    function position(
        bytes32 id,
        address user
    ) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);

    function market(
        bytes32 id
    ) external view returns (
        uint128 totalSupplyAssets,
        uint128 totalSupplyShares,
        uint128 totalBorrowAssets,
        uint128 totalBorrowShares,
        uint128 lastUpdate,
        uint128 fee
    );

    /// @notice Authorize an address to manage positions on behalf of msg.sender
    /// @param authorized Address to authorize/deauthorize
    /// @param newIsAuthorized Whether to authorize or deauthorize
    function setAuthorization(address authorized, bool newIsAuthorized) external;

    /// @notice Check if an address is authorized to manage positions on behalf of another
    /// @param authorizer The position owner
    /// @param authorized The address to check
    /// @return True if authorized
    function isAuthorized(address authorizer, address authorized) external view returns (bool);
}
