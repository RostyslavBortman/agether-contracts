// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title PackedUserOperation
 * @notice ERC-4337 v0.7 UserOperation struct
 * @dev This is the "packed" format used by EntryPoint v0.7.
 *      Bundlers submit arrays of these to EntryPoint.handleOps().
 *      The EntryPoint calls account.validateUserOp() with this struct.
 */
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;    // packed: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
    uint256 preVerificationGas;
    bytes32 gasFees;             // packed: maxPriorityFeePerGas (16 bytes) | maxFeePerGas (16 bytes)
    bytes paymasterAndData;
    bytes signature;
}

/**
 * @title IEntryPoint
 * @notice Minimal interface for ERC-4337 EntryPoint v0.7
 * @dev EntryPoint v0.7 on all chains: 0x0000000071727De22E5E9d8BAf0edAc6f37da032
 */
interface IEntryPoint {
    /// @notice Handle an array of UserOperations
    function handleOps(
        PackedUserOperation[] calldata ops,
        address payable beneficiary
    ) external;

    /// @notice Get the nonce for an account + key pair
    function getNonce(address sender, uint192 key) external view returns (uint256 nonce);

    /// @notice Get the deposit balance for an account
    function balanceOf(address account) external view returns (uint256);

    /// @notice Deposit ETH for an account
    function depositTo(address account) external payable;
}
