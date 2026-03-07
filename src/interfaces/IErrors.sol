// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IErrors
 * @notice All custom errors for the Agether protocol
 * @dev Usage: import {IErrors as IA} from "./interfaces/IErrors.sol";
 *      Then: revert IA.ZeroAddress();
 */
interface IErrors {
    
    // ============ Common Errors ============
    
    /// @notice Thrown when address is zero
    error ZeroAddress();
    
    /// @notice Thrown when amount is zero
    error ZeroAmount();
    
    /// @notice Thrown when caller is not authorized
    error Unauthorized();
    
    /// @notice Thrown when array lengths don't match
    error LengthMismatch();
    
    /// @notice Thrown when value exceeds maximum
    error ExceedsMaximum(uint256 value, uint256 maximum);
    
    /// @notice Thrown when value is below minimum
    error BelowMinimum(uint256 value, uint256 minimum);
    
    /// @notice Thrown when value is above maximum
    error AboveMaximum(uint256 value, uint256 maximum);
    
    /// @notice Thrown when already set
    error AlreadySet();
    
    // ============ Account Errors ============
    
    /// @notice Thrown when caller is not the account owner
    error NotOwner();
    
    /// @notice Thrown when a low-level call fails (includes inner revert reason)
    error ExecutionFailed(address target, bytes data, bytes returnData);
    
    /// @notice Thrown when array lengths don't match (batch)
    error ArrayLengthMismatch();
    
    /// @notice Thrown when ETH transfer fails
    error ETHTransferFailed();
    
    /// @notice Thrown when agent code is not approved in ValidationRegistry
    error CodeNotApproved(uint256 agentId);
    
    // ============ Agether4337Factory Errors ============
    
    /// @notice Thrown when an account already exists for the agent
    error AccountAlreadyExists(uint256 agentId, address existing);
    
    /// @notice Thrown when caller is not the agent NFT owner (3-param variant)
    error NotAgentNFTOwner(uint256 agentId, address caller, address owner);
    
    // ============ Agether8004Scorer Errors ============
    
    /// @notice Thrown when oracle attestation signature is invalid
    error InvalidOracleSignature();
    
    /// @notice Thrown when oracle attestation is expired
    error OracleAttestationExpired(uint256 timestamp, uint256 maxAge);
    
    /// @notice Thrown when oracle signer is not set
    error OracleSignerNotSet();
    
    // ============ ValidationRegistry Errors ============
    
    /// @notice Thrown when caller is not the agent owner or operator
    error NotAgentOwnerOrOperator(uint256 agentId, address caller);
    
    /// @notice Thrown when caller is not the requested validator
    error NotRequestedValidator(bytes32 requestHash, address caller);
    
    /// @notice Thrown when validation request is not found
    error RequestNotFound(bytes32 requestHash);
    
    /// @notice Thrown when validation response is invalid
    error InvalidResponse(uint8 response);
    
    /// @notice Thrown when request hash is empty
    error EmptyRequestHash();

    /// @notice Thrown when a validation request with this hash already exists
    error RequestAlreadyExists(bytes32 requestHash);

    // ============ ERC-7579 Module Errors ============

    /// @notice Thrown when caller is not an installed executor module
    error NotExecutor(address caller);

    /// @notice Thrown when module type doesn't match what the module reports
    error ModuleTypeMismatch(uint256 expectedType, address module);

    /// @notice Thrown when trying to install an already-installed module
    error ModuleAlreadyInstalled(uint256 moduleTypeId, address module);

    /// @notice Thrown when trying to uninstall a module that is not installed
    error ModuleNotInstalled(uint256 moduleTypeId, address module);

    /// @notice Thrown when a hook is already installed (only one allowed)
    error HookAlreadyInstalled(address existing);

    /// @notice Thrown when a fallback handler is already installed (only one allowed)
    error FallbackAlreadyInstalled(address existing);

    /// @notice Thrown when an unsupported module type is provided
    error UnsupportedModuleType(uint256 moduleTypeId);

    /// @notice Thrown when an unsupported call type is used in execution mode
    error UnsupportedCallType(bytes1 callType);

    /// @notice Thrown when no fallback handler is installed but fallback is called
    error NoFallbackHandler();

    // ============ Agether8004ValidationModule Errors ============

    /// @notice Thrown when module is already installed for an account
    error AlreadyInstalled(address account);

    /// @notice Thrown when trying to uninstall a non-removable module
    error CannotUninstall();

    /// @notice Thrown when identity registry address is invalid
    error InvalidRegistryAddress();

    // ============ AgetherHookMultiplexer Errors ============

    /// @notice Thrown when too many sub-hooks are added
    error TooManyHooks(uint256 max);

    /// @notice Thrown when sub-hook is already added
    error HookAlreadyAdded(address hook);

    /// @notice Thrown when sub-hook is not found
    error HookNotFound(address hook);

    /// @notice Thrown when V2 storage has already been initialized
    error V2AlreadyInitialized();
}
