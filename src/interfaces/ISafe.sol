// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.20;

/**
 * @title ISafe
 * @notice Minimal interface for Safe (Gnosis Safe) smart accounts
 * @dev Only includes functions needed by our factory and bootstrap.
 *      Full Safe is already deployed on Base — we just interact with it.
 *
 *      Safe v1.4.1 on Base: 0x41675C099F32341bf84BFc5382aF534df5C7461a
 */
interface ISafe {
    /// @notice Setup function — called once during proxy creation
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

    /// @notice Enable a module on this Safe
    function enableModule(address module) external;

    /// @notice Check if a module is enabled
    function isModuleEnabled(address module) external view returns (bool);

    /// @notice Execute a transaction from an enabled module
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success);

    /// @notice Execute a transaction from an enabled module, returning data
    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success, bytes memory returnData);

    /// @notice Get the list of Safe owners
    function getOwners() external view returns (address[] memory);

    /// @notice Get the current threshold
    function getThreshold() external view returns (uint256);

    /// @notice Check if an address is a Safe owner
    function isOwner(address owner) external view returns (bool);

    /// @notice Get the nonce
    function nonce() external view returns (uint256);

    /// @notice Get the domain separator
    function domainSeparator() external view returns (bytes32);

    /// @notice Check signed messages
    function signedMessages(bytes32 messageHash) external view returns (uint256);

    /// @notice Check signatures
    function checkSignatures(
        bytes32 dataHash,
        bytes memory data,
        bytes memory signatures
    ) external view;

    /// @notice Swap an owner
    function swapOwner(
        address prevOwner,
        address oldOwner,
        address newOwner
    ) external;
}

/**
 * @title ISafeProxyFactory
 * @notice Interface for Safe Proxy Factory
 * @dev Safe Proxy Factory on Base: 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
 */
interface ISafeProxyFactory {
    /// @notice Create a new Safe proxy with a deterministic address
    function createProxyWithNonce(
        address _singleton,
        bytes memory initializer,
        uint256 saltNonce
    ) external returns (address proxy);

    /// @notice Compute the deterministic address
    function createChainSpecificProxyWithNonce(
        address _singleton,
        bytes memory initializer,
        uint256 saltNonce
    ) external returns (address proxy);

    /// @notice Get the proxy creation code
    function proxyCreationCode() external pure returns (bytes memory);
}
