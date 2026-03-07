// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "./IEntryPoint.sol";

/**
 * @title ISafe7579
 * @notice Minimal interface for Safe7579 adapter
 * @dev Safe7579 makes Safe accounts fully ERC-7579 compliant.
 *      It's installed as a Safe module + fallback handler.
 *      Already deployed on Base via Rhinestone's deterministic deployer.
 *
 *      Key: Safe7579 is a singleton — one deployment serves ALL Safe accounts.
 *      Each Safe enables it as a module, and it stores per-account module state.
 */
interface ISafe7579 {

    // ═══════════════════════════════════════════════════════════════════════
    //                         MODULE TYPES
    // ═══════════════════════════════════════════════════════════════════════

    // MODULE_TYPE_VALIDATOR = 1
    // MODULE_TYPE_EXECUTOR = 2
    // MODULE_TYPE_FALLBACK = 3
    // MODULE_TYPE_HOOK = 4

    // ═══════════════════════════════════════════════════════════════════════
    //                     INITIALIZATION (for new accounts)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Module descriptor: just address + init calldata (type is implicit from the array).
    struct ModuleInit {
        address module;
        bytes initData;
    }

    struct RegistryInit {
        address registry;
        address[] attesters;
        uint8 threshold;
    }

    /**
     * @notice Initialize Safe7579 for a Safe account with modules
     * @dev Called via the Safe's fallback handler (which is Safe7579).
     *      The bootstrap calls this on address(this) so the call routes
     *      through FallbackManager → Safe7579 with correct ERC-2771 context.
     *
     *      Each module type has its own array (matching the deployed Safe7579 ABI).
     *
     * @param validators  Validator modules (type 1)
     * @param executors   Executor modules  (type 2)
     * @param fallbacks   Fallback modules  (type 3)
     * @param hooks       Hook modules      (type 4)
     * @param registryInit Optional IERC7484 registry config (can be zeros)
     */
    function initializeAccount(
        ModuleInit[] calldata validators,
        ModuleInit[] calldata executors,
        ModuleInit[] calldata fallbacks,
        ModuleInit[] calldata hooks,
        RegistryInit calldata registryInit
    ) external;

    // ═══════════════════════════════════════════════════════════════════════
    //                          7579 EXECUTION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Execute a transaction (called by EntryPoint or Safe owner)
    function execute(bytes32 mode, bytes calldata executionCalldata) external;

    /// @notice Execute from an installed executor module
    function executeFromExecutor(
        bytes32 mode,
        bytes calldata executionCalldata
    ) external returns (bytes[] memory returnData);

    // ═══════════════════════════════════════════════════════════════════════
    //                        MODULE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Install a module
    function installModule(
        uint256 moduleType,
        address module,
        bytes calldata initData
    ) external;

    /// @notice Uninstall a module
    function uninstallModule(
        uint256 moduleType,
        address module,
        bytes calldata deInitData
    ) external;

    /// @notice Check if a module is installed
    function isModuleInstalled(
        uint256 moduleType,
        address module,
        bytes calldata additionalContext
    ) external view returns (bool);

    // ═══════════════════════════════════════════════════════════════════════
    //                          4337 VALIDATION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Validate a UserOp (called by EntryPoint via Safe)
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);

    /// @notice ERC-1271 signature validation
    function isValidSignature(
        bytes32 hash,
        bytes calldata data
    ) external view returns (bytes4 magicValue);

    /// @notice Get nonce for a Safe + validator pair
    function getNonce(address safe, address validator) external view returns (uint256 nonce);

    /// @notice Get the EntryPoint address
    function entryPoint() external view returns (address);
}
