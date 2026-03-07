// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PackedUserOperation} from "./IEntryPoint.sol";

/// @dev Module type constants (ERC-7579)
uint256 constant MODULE_TYPE_VALIDATOR = 1;
uint256 constant MODULE_TYPE_EXECUTOR = 2;
uint256 constant MODULE_TYPE_FALLBACK = 3;
uint256 constant MODULE_TYPE_HOOK = 4;

// ═══════════════════════════════════════════════════════════════════════════
//                           BASE MODULE
// ═══════════════════════════════════════════════════════════════════════════

interface IModule {
    /**
     * @notice Called when the module is installed on an account
     * @param data Initialization data
     */
    function onInstall(bytes calldata data) external;

    /**
     * @notice Called when the module is uninstalled from an account
     * @param data De-initialization data
     */
    function onUninstall(bytes calldata data) external;

    /**
     * @notice Check if the module is of a certain type
     * @param moduleTypeId The module type (1=validator, 2=executor, 3=fallback, 4=hook)
     * @return True if the module is of the given type
     */
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
}

// ═══════════════════════════════════════════════════════════════════════════
//                          VALIDATOR MODULE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @title IValidator
 * @notice Validator module for ERC-7579 accounts
 * @dev Validates ERC-4337 UserOperations and ERC-1271 signatures.
 *      Safe7579 routes validation to the selected validator module:
 *      - For 4337: validator address encoded in userOp.nonce key
 *      - For 1271: validator address is first 20 bytes of signature data
 */
interface IValidator is IModule {
    /**
     * @notice Validate an ERC-4337 UserOperation
     * @dev Called by Safe7579 during EntryPoint.validateUserOp flow.
     *      Safe7579 extracts the validator from the nonce key and calls this.
     * @param userOp The packed UserOperation from the bundler
     * @param userOpHash The hash of the UserOperation (signed by user)
     * @return validationData 0 if valid, 1 if invalid, or packed (authorizer, validUntil, validAfter)
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256 validationData);

    /**
     * @notice Validate an ERC-1271 signature with sender context
     * @dev Called by Safe7579 during isValidSignature flow.
     *      Enables x402 payments and other smart-wallet signature use cases.
     * @param sender The original caller of isValidSignature on the Safe
     * @param hash The hash being validated
     * @param data The signature data (after validator address prefix is stripped)
     * @return magicValue 0x1626ba7e if valid, 0xffffffff if invalid
     */
    function isValidSignatureWithSender(
        address sender,
        bytes32 hash,
        bytes calldata data
    ) external view returns (bytes4);
}

// ═══════════════════════════════════════════════════════════════════════════
//                          EXECUTOR MODULE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @title IExecutor
 * @notice Executor module interface
 * @dev Executors can trigger transactions on the account via executeFromExecutor().
 *      Use cases: scheduled payments, DCA strategies, auto-rebalancing, yield harvesting.
 */
interface IExecutor is IModule {
    // Executors call account.executeFromExecutor() directly.
    // No additional interface methods required beyond IModule.
}

// ═══════════════════════════════════════════════════════════════════════════
//                            HOOK MODULE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @title IHook
 * @notice Hook module interface — pre/post execution checks
 * @dev Use cases: daily spend limits, token allowlists, rate limiting.
 *      preCheck can revert to block execution, postCheck for bookkeeping.
 */
interface IHook is IModule {
    /**
     * @notice Called before execution
     * @param msgSender The caller of the execution
     * @param msgValue The ETH value of the execution
     * @param msgData The calldata of the execution
     * @return hookData Context data to pass to postCheck
     */
    function preCheck(
        address msgSender,
        uint256 msgValue,
        bytes calldata msgData
    ) external returns (bytes memory hookData);

    /**
     * @notice Called after execution
     * @param hookData Context data from preCheck
     */
    function postCheck(bytes calldata hookData) external;
}

// ═══════════════════════════════════════════════════════════════════════════
//                         FALLBACK MODULE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @title IFallback
 * @notice Fallback handler module — routes unknown selectors
 * @dev Enables extending account functionality without upgrading.
 *      Account's fallback() delegates to the registered fallback module.
 */
interface IFallback is IModule {
    // Fallback modules receive calls via delegatecall or staticcall.
    // No additional interface methods required beyond IModule.
}
