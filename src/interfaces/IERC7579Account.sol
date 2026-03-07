// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC7579Account
 * @notice Minimal Account Interface (ERC-7579)
 * @dev https://eips.ethereum.org/EIPS/eip-7579
 *
 *      ModeCode layout (bytes32):
 *      ┌──────────┬──────────┬──────────┬──────────────┬──────────────┐
 *      │ callType │ execType │ unused   │ modeSelector │ modePayload  │
 *      │ 1 byte   │ 1 byte   │ 4 bytes  │ 4 bytes      │ 22 bytes     │
 *      └──────────┴──────────┴──────────┴──────────────┴──────────────┘
 *
 *      Module types:
 *        1 = Validator   — validates userOps / signatures
 *        2 = Executor    — can call executeFromExecutor()
 *        3 = Fallback    — handles unknown function selectors
 *        4 = Hook        — pre/post execution hooks
 */
interface IERC7579Account {

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event ModuleInstalled(uint256 moduleTypeId, address module);
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    // ═══════════════════════════════════════════════════════════════════════
    //                           EXECUTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Execute a transaction in the context of this account
     * @dev MUST validate the caller (e.g. only owner or EntryPoint)
     * @param mode The encoded execution mode (callType, execType, etc.)
     * @param executionCalldata The encoded execution data
     */
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;

    /**
     * @notice Execute a transaction from an installed executor module
     * @dev MUST validate that msg.sender is an installed executor
     * @param mode The encoded execution mode
     * @param executionCalldata The encoded execution data
     * @return returnData The return data from the execution(s)
     */
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory returnData);

    // ═══════════════════════════════════════════════════════════════════════
    //                        MODULE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Install a module on the account
     * @dev MUST validate the caller (e.g. only owner or self)
     * @param moduleTypeId The type of module (1=validator, 2=executor, 3=fallback, 4=hook)
     * @param module The module address
     * @param initData Initialization data for the module
     */
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external payable;

    /**
     * @notice Uninstall a module from the account
     * @param moduleTypeId The type of module
     * @param module The module address
     * @param deInitData De-initialization data for the module
     */
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external payable;

    // ═══════════════════════════════════════════════════════════════════════
    //                            QUERIES
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Check if a module is installed
     * @param moduleTypeId The type of module
     * @param module The module address
     * @param additionalContext Additional context for the check
     * @return True if the module is installed
     */
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata additionalContext)
        external
        view
        returns (bool);

    /**
     * @notice Check if an execution mode is supported
     * @param mode The execution mode to check
     * @return True if supported
     */
    function supportsExecutionMode(bytes32 mode) external view returns (bool);

    /**
     * @notice Check if a module type is supported
     * @param moduleTypeId The module type to check
     * @return True if supported
     */
    function supportsModule(uint256 moduleTypeId) external view returns (bool);

    /**
     * @notice Return the account implementation identifier
     * @return The account ID string (e.g. "agether.agent-account.v2.0.0")
     */
    function accountId() external view returns (string memory);
}
