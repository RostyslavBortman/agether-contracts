// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC7579Module.sol";
import "../interfaces/IERC7579Account.sol";
import {PackedUserOperation} from "../interfaces/IEntryPoint.sol";

/**
 * @title MockModule
 * @notice Mock ERC-7579 module for testing
 * @dev Can act as any module type based on constructor parameter.
 *      For executor testing, exposes triggerExecution() to call
 *      executeFromExecutor() on the target account.
 */
contract MockModule is IModule, IValidator, IHook {

    uint256 public moduleType;
    bool public installed;
    bytes public lastInstallData;
    bytes public lastUninstallData;

    // Hook tracking
    uint256 public preCheckCount;
    uint256 public postCheckCount;

    constructor(uint256 _moduleType) {
        moduleType = _moduleType;
    }

    // ── IModule ─────────────────────────────────────────────────────────

    function onInstall(bytes calldata data) external override(IModule) {
        installed = true;
        lastInstallData = data;
    }

    function onUninstall(bytes calldata data) external override(IModule) {
        installed = false;
        lastUninstallData = data;
    }

    function isModuleType(uint256 moduleTypeId) external view override(IModule) returns (bool) {
        return moduleTypeId == moduleType;
    }

    // ── IValidator ──────────────────────────────────────────────────────

    function validateUserOp(
        PackedUserOperation calldata,
        bytes32
    ) external pure override returns (uint256) {
        return 0; // Always valid
    }

    function isValidSignatureWithSender(
        address,
        bytes32,
        bytes calldata
    ) external pure override returns (bytes4) {
        return 0x1626ba7e; // Always valid
    }

    // ── IHook ───────────────────────────────────────────────────────────

    function preCheck(
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes memory) {
        preCheckCount++;
        return abi.encode(preCheckCount);
    }

    function postCheck(bytes calldata) external override {
        postCheckCount++;
    }

    // ── Executor helper ─────────────────────────────────────────────────

    /**
     * @notice Trigger executeFromExecutor on a target account
     * @dev This simulates an executor module calling back into the account
     */
    function triggerExecution(
        address account,
        bytes32 mode,
        bytes calldata executionCalldata
    ) external returns (bytes[] memory) {
        return IERC7579Account(account).executeFromExecutor(mode, executionCalldata);
    }
}
