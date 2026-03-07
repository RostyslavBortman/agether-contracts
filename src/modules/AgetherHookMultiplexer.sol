// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IERC7579Module.sol";
import {IErrors as IA} from "../interfaces/IErrors.sol";
import {IEvents as IE} from "../interfaces/IEvents.sol";
import {Constants as C} from "../libraries/Constants.sol";

/**
 * @title AgetherHookMultiplexer
 * @notice Admin-managed ERC-7579 hook that chains multiple sub-hooks
 * @dev Singleton contract — one instance for ALL agent Safe accounts.
 *      Installed as the sole hook on every Safe via the factory.
 *
 *      Architecture:
 *      - Owner = TimelockController (protocol admin)
 *      - Admin adds/removes sub-hooks that apply to ALL accounts
 *      - On every execution, Safe7579 calls preCheck/postCheck on this
 *      - This contract iterates over all sub-hooks and calls each one
 *      - Users CANNOT modify hooks (validator blocks installModule/uninstallModule)
 *
 *      Current sub-hooks: NONE (v1 placeholder)
 *      Future sub-hooks: SpendLimitHook, TokenAllowlistHook, RateLimitHook
 *
 *      Non-removable:
 *      - onUninstall() reverts unconditionally
 *      - The Agether8004ValidationModule blocks all uninstallModule UserOps
 *
 *      Sub-hook calling convention:
 *      - preCheck: multiplexer calls subHook.preCheck(msgSender, msgValue, msgData)
 *        where msg.sender to the sub-hook is this multiplexer (not the Safe).
 *        Sub-hooks needing the account address should read it from the
 *        msgSender parameter or use a transient storage pattern.
 *      - postCheck: multiplexer decodes stored hookData and calls each sub-hook
 */
contract AgetherHookMultiplexer is IHook, Ownable {

    // ═══════════════════════════════════════════════════════════════════════
    //                              STORAGE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Ordered list of sub-hooks
    address[] private _hooks;

    /// @notice Quick lookup: hook address => installed
    mapping(address => bool) private _isHook;

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Deploy the AgetherHookMultiplexer
     * @param owner_ Owner who manages sub-hooks (should be TimelockController)
     */
    constructor(address owner_) Ownable(owner_) {}

    // ═══════════════════════════════════════════════════════════════════════
    //                          ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Add a sub-hook to the chain
     * @dev Only callable by owner (TimelockController).
     *      Affects ALL accounts immediately.
     * @param hook The sub-hook contract address (must implement IHook)
     */
    function addHook(address hook) external onlyOwner {
        if (hook == address(0)) revert IA.ZeroAddress();
        if (_isHook[hook]) revert IA.HookAlreadyAdded(hook);
        if (_hooks.length >= C.MAX_HOOKS) revert IA.TooManyHooks(C.MAX_HOOKS);

        _hooks.push(hook);
        _isHook[hook] = true;

        emit IE.SubHookAdded(hook, _hooks.length);
    }

    /**
     * @notice Remove a sub-hook from the chain
     * @dev Only callable by owner (TimelockController).
     *      Swaps with last element + pop for O(1) removal.
     *      Order may change — sub-hooks should not depend on execution order.
     * @param hook The sub-hook to remove
     */
    function removeHook(address hook) external onlyOwner {
        if (!_isHook[hook]) revert IA.HookNotFound(hook);

        // Find and swap-remove
        uint256 len = _hooks.length;
        for (uint256 i; i < len; i++) {
            if (_hooks[i] == hook) {
                _hooks[i] = _hooks[len - 1];
                _hooks.pop();
                break;
            }
        }
        _isHook[hook] = false;

        emit IE.SubHookRemoved(hook, _hooks.length);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          MODULE LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════

    /// @inheritdoc IModule
    /// @dev No per-account state needed — sub-hooks are protocol-wide
    function onInstall(bytes calldata) external override {
        // Nothing to initialize per account
    }

    /// @inheritdoc IModule
    /// @dev ALWAYS REVERTS — this hook is non-removable
    function onUninstall(bytes calldata) external pure override {
        revert IA.CannotUninstall();
    }

    /// @inheritdoc IModule
    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_HOOK;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                            HOOK LOGIC
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Pre-execution check — calls all sub-hooks
     * @dev Called by Safe7579 before every execution.
     *      Iterates over all sub-hooks and calls preCheck on each.
     *      If ANY sub-hook reverts, the entire execution is blocked.
     *
     *      Returns abi.encoded array of all sub-hook hookDatas for postCheck.
     *
     * @param msgSender The original caller of the execution
     * @param msgValue The ETH value
     * @param msgData The calldata
     * @return hookData Encoded sub-hook data for postCheck
     */
    function preCheck(
        address msgSender,
        uint256 msgValue,
        bytes calldata msgData
    ) external override returns (bytes memory hookData) {
        uint256 len = _hooks.length;
        if (len == 0) return "";

        bytes[] memory hookDatas = new bytes[](len);
        for (uint256 i; i < len; i++) {
            hookDatas[i] = IHook(_hooks[i]).preCheck(msgSender, msgValue, msgData);
        }

        return abi.encode(hookDatas);
    }

    /**
     * @notice Post-execution check — calls all sub-hooks
     * @dev Called by Safe7579 after every execution.
     *      Decodes the hookData from preCheck and calls postCheck on each sub-hook.
     *
     * @param hookData The encoded data from preCheck
     */
    function postCheck(bytes calldata hookData) external override {
        uint256 len = _hooks.length;
        if (len == 0) return;

        bytes[] memory hookDatas = abi.decode(hookData, (bytes[]));
        for (uint256 i; i < len; i++) {
            IHook(_hooks[i]).postCheck(hookDatas[i]);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get all installed sub-hooks
    function getHooks() external view returns (address[] memory) {
        return _hooks;
    }

    /// @notice Get the number of installed sub-hooks
    function hookCount() external view returns (uint256) {
        return _hooks.length;
    }

    /// @notice Check if an address is an installed sub-hook
    function isSubHook(address hook) external view returns (bool) {
        return _isHook[hook];
    }
}
