// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../interfaces/IERC7579Module.sol";
import "../interfaces/IERC8004.sol";
import "../interfaces/IERC8004ValidationRegistry.sol";
import {PackedUserOperation} from "../interfaces/IEntryPoint.sol";
import {IErrors as IA} from "../interfaces/IErrors.sol";
import {IEvents as IE} from "../interfaces/IEvents.sol";
import {Constants as C} from "../libraries/Constants.sol";
import {ERC7579ModeLib, Execution} from "../libraries/ERC7579ModeLib.sol";

/**
 * @title Agether8004ValidationModule
 * @notice The single mandatory ERC-7579 validator for all agent Safe accounts
 * @dev Combines three responsibilities into one non-removable module:
 *
 *      1. OWNERSHIP — Validates that the UserOp signer is the current
 *         holder of the agent's ERC-8004 NFT. Ownership is read LIVE
 *         from the registry (not cached), so NFT transfers instantly
 *         change who can control the Safe.
 *
 *      2. KYA GATE — Checks that the agent's code is approved in the
 *         ValidationRegistry before allowing any execution. If the
 *         registry is not set (address(0)), the gate is disabled.
 *
 *      3. MODULE LOCK — Blocks all installModule / uninstallModule calls
 *         in UserOps. The factory sets up the Safe's modules at creation
 *         time, and users cannot change them. This prevents agents from
 *         removing the validator, hook, or installing rogue executors.
 *
 *      Architecture:
 *      ┌─────────────┐     ┌───────────┐     ┌────────────────────────────────┐
 *      │  EntryPoint  │────▶│  Safe7579  │────▶│  Agether8004ValidationModule  │
 *      │  (4337)      │     │  adapter   │     │                                │
 *      └─────────────┘     └───────────┘     │  1. Block module mgmt          │
 *                                              │  2. Check KYA approval         │
 *      ┌─────────────┐     ┌───────────┐     │  3. Verify NFT ownership       │
 *      │  USDC/x402   │────▶│  Safe7579  │────▶│  4. ERC-1271 signatures        │
 *      │  (1271)      │     │  adapter   │     └────────────────────────────────┘
 *      └─────────────┘     └───────────┘
 *
 *      Storage model:
 *      - Per-account: (identityRegistry, agentId) stored on onInstall
 *      - Protocol-wide: validationRegistry, set by owner (timelock)
 *
 *      Non-removable:
 *      - onUninstall() reverts unconditionally
 *      - validateUserOp() rejects any uninstallModule calls
 *      - Safe owner is a sentinel (no execTransaction possible)
 */
contract Agether8004ValidationModule is IValidator, Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STORAGE
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Per-account configuration: Safe address => config
    struct AccountConfig {
        IERC8004 identityRegistry;
        uint256 agentId;
    }
    mapping(address => AccountConfig) private _configs;

    /// @notice Protocol-wide KYA ValidationRegistry
    /// @dev address(0) = KYA gate disabled (all agents pass)
    IERC8004ValidationRegistry public validationRegistry;

    // ═══════════════════════════════════════════════════════════════════════
    //                           STORAGE GAP
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Reserved storage for future upgrades (50 − 2 used = 48 slots)
    uint256[48] private __gap;

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                            INITIALIZER
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize the validation module (replaces constructor for proxy)
     * @param owner_ Owner who can set the ValidationRegistry (should be TimelockController)
     */
    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Set or update the protocol-wide ValidationRegistry
     * @dev Only callable by owner (TimelockController).
     *      Pass address(0) to disable KYA gate (all agents pass).
     * @param registry_ The ValidationRegistry address (or address(0) to disable)
     */
    function setValidationRegistry(address registry_) external onlyOwner {
        address old = address(validationRegistry);
        validationRegistry = IERC8004ValidationRegistry(registry_);
        emit IE.ValidationRegistryUpdated(old, registry_);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          MODULE LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Install validator for an account
     * @dev Called by Safe7579 during account initialization.
     *      In Safe7579, onInstall is called via Safe → module (CALL),
     *      so msg.sender = the Safe account address.
     * @param data abi.encode(address identityRegistry, uint256 agentId)
     */
    function onInstall(bytes calldata data) external override {
        if (address(_configs[msg.sender].identityRegistry) != address(0)) {
            revert IA.AlreadyInstalled(msg.sender);
        }

        (address registry, uint256 agentId) = abi.decode(data, (address, uint256));
        if (registry == address(0)) revert IA.InvalidRegistryAddress();

        _configs[msg.sender] = AccountConfig({
            identityRegistry: IERC8004(registry),
            agentId: agentId
        });

        emit IE.ModuleInstalled(msg.sender, registry, agentId);
    }

    /**
     * @notice Uninstall — ALWAYS REVERTS
     * @dev This module is non-removable. The validator also blocks
     *      uninstallModule UserOps, so this is a belt-and-suspenders defense.
     */
    function onUninstall(bytes calldata) external pure override {
        revert IA.CannotUninstall();
    }

    /// @inheritdoc IModule
    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     ERC-4337 VALIDATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Validate a UserOperation
     * @dev Called by Safe7579 during EntryPoint.handleOps() flow.
     *      Performs three checks in order:
     *
     *      1. MODULE LOCK — Reject if callData targets installModule or
     *         uninstallModule. This prevents the user from modifying the
     *         Safe's module configuration after creation.
     *
     *      2. KYA GATE — If validationRegistry is set, check that the
     *         agent's code is approved. Reject if not.
     *
     *      3. OWNERSHIP — Recover the signer from the signature and verify
     *         it matches identityRegistry.ownerOf(agentId). This reads
     *         ownership LIVE — if the NFT transfers, the new owner
     *         immediately controls the Safe.
     *
     * @param userOp The packed UserOperation
     * @param userOpHash The hash signed by the user
     * @return validationData 0 if valid, 1 if invalid
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external view override returns (uint256 validationData) {
        // ── 1. Module management lock ────────────────────────────────────
        //    Block direct installModule/uninstallModule AND self-calls
        //    wrapped inside execute() that could bypass the selector check.
        if (userOp.callData.length >= 4) {
            bytes4 selector = bytes4(userOp.callData[:4]);

            // Direct module management calls — always blocked
            if (selector == C.INSTALL_MODULE_SELECTOR || selector == C.UNINSTALL_MODULE_SELECTOR) {
                return C.SIG_VALIDATION_FAILED;
            }

            // executeFromExecutor — belt-and-suspenders block
            if (selector == C.EXECUTE_FROM_EXECUTOR_SELECTOR) {
                return C.SIG_VALIDATION_FAILED;
            }

            // execute() wrapping bypass, inspect inner calldata
            // to detect install/uninstall hidden inside execute/batch
            if (selector == C.EXECUTE_SELECTOR && userOp.callData.length >= 100) {
                if (_executionTargetsSelf(userOp.sender, userOp.callData)) {
                    return C.SIG_VALIDATION_FAILED;
                }
            }
        }

        // ── 2. Account config lookup ─────────────────────────────────────
        AccountConfig storage config = _configs[userOp.sender];
        if (address(config.identityRegistry) == address(0)) {
            return C.SIG_VALIDATION_FAILED; // not installed for this account
        }

        // ── 3. KYA gate ─────────────────────────────────────────────────
        IERC8004ValidationRegistry registry = validationRegistry;
        if (address(registry) != address(0)) {
            if (!registry.isAgentCodeApproved(config.agentId)) {
                return C.SIG_VALIDATION_FAILED;
            }
        }

        // ── 4. Ownership check ───────────────────────────────────────────
        address currentOwner = config.identityRegistry.ownerOf(config.agentId);

        return _isValidSigner(userOpHash, userOp.signature, currentOwner)
            ? C.SIG_VALIDATION_SUCCESS
            : C.SIG_VALIDATION_FAILED;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     ERC-1271 VALIDATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Validate an ERC-1271 signature with sender context
     * @dev Called by Safe7579 during isValidSignature flow.
     *      Used for x402 payments: USDC.transferWithAuthorization checks
     *      isValidSignature on the Safe, which routes through Safe7579
     *      to this validator.
     *
     *      KYA gate IS enforced for ERC-1271 (H-01 fix).
     *      ERC-1271 signatures can authorize value transfers (EIP-3009,
     *      Permit2, x402), so a revoked agent must not be able to sign.
     *
     *      Supports padded signatures (>65 bytes) for x402 smart-wallet path.
     *
     * @param hash The hash to validate
     * @param data The signature bytes
     * @return magicValue 0x1626ba7e if valid, 0xffffffff if invalid
     */
    function isValidSignatureWithSender(
        address,       // sender — not used for ownership check
        bytes32 hash,
        bytes calldata data
    ) external view override returns (bytes4) {
        AccountConfig storage config = _configs[msg.sender];
        if (address(config.identityRegistry) == address(0)) {
            return C.EIP1271_INVALID;
        }

        // KYA gate — block signatures from revoked agents (H-01)
        IERC8004ValidationRegistry registry = validationRegistry;
        if (address(registry) != address(0)) {
            if (!registry.isAgentCodeApproved(config.agentId)) {
                return C.EIP1271_INVALID;
            }
        }

        address currentOwner = config.identityRegistry.ownerOf(config.agentId);

        return _isValidSigner(hash, data, currentOwner) ? C.EIP1271_MAGIC : C.EIP1271_INVALID;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get the config for an account
    function getConfig(address account) external view returns (address registry, uint256 agentId) {
        AccountConfig storage config = _configs[account];
        return (address(config.identityRegistry), config.agentId);
    }

    /// @notice Get the current owner of an account (live from ERC-8004)
    function getOwner(address account) external view returns (address) {
        AccountConfig storage config = _configs[account];
        if (address(config.identityRegistry) == address(0)) return address(0);
        return config.identityRegistry.ownerOf(config.agentId);
    }

    /// @notice Check if this validator is installed for an account
    function isInstalled(address account) external view returns (bool) {
        return address(_configs[account].identityRegistry) != address(0);
    }

    /// @notice Check if an agent's KYA code is currently approved
    function isKYAApproved(address account) external view returns (bool) {
        IERC8004ValidationRegistry registry = validationRegistry;
        if (address(registry) == address(0)) return true; // gate disabled
        AccountConfig storage config = _configs[account];
        if (address(config.identityRegistry) == address(0)) return false;
        return registry.isAgentCodeApproved(config.agentId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Authorize UUPS upgrades — only owner (TimelockController)
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        if (newImplementation == address(0)) revert IA.ZeroAddress();
        if (newImplementation.code.length == 0) revert IA.ZeroAddress();
    }

    /**
     * @dev Check if a signature was produced by the expected signer.
     *      Tries two recovery approaches:
     *      1. Raw hash (ERC-4337 userOpHash — already a proper digest)
     *      2. ethSignedMessageHash (for ERC-1271 / personal_sign)
     *
     *      This avoids the pitfall of raw ecrecover returning a garbage
     *      address: we compare against the expected signer for each path.
     *
     *      Supports padded signatures (>65 bytes) from x402 smart-wallet.
     */
    function _isValidSigner(
        bytes32 hash,
        bytes memory signature,
        address expectedSigner
    ) internal pure returns (bool) {
        if (signature.length < 65) return false;

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        // Try raw hash first (ERC-4337 userOpHash is already a digest)
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, v, r, s);
        if (err == ECDSA.RecoverError.NoError && recovered == expectedSigner) {
            return true;
        }

        // Fallback: try ethSignedMessageHash (for ERC-1271 with personal_sign)
        (recovered, err,) = ECDSA.tryRecover(hash.toEthSignedMessageHash(), v, r, s);
        if (err == ECDSA.RecoverError.NoError && recovered == expectedSigner) {
            return true;
        }

        return false;
    }

    /**
     * @dev Detect if an execute() call targets the Safe itself.
     *      Uses canonical ERC-7579 mode + execution encoding via our ModeLib:
     *        - Single:       abi.encodePacked(target, value, calldata)
     *        - Batch:        abi.encode(Execution[])
     *        - Delegatecall: always blocked (arbitrary storage writes)
     *
     * @param account The Safe account address (userOp.sender)
     * @param callData The full userOp.callData (starts with execute selector)
     * @return blocked True if the execution should be rejected
     */
    function _executionTargetsSelf(
        address account,
        bytes calldata callData
    ) internal pure returns (bool) {
        // Decode execute(bytes32 mode, bytes executionCalldata) — skip 4-byte selector
        (bytes32 mode, bytes memory execData) = abi.decode(callData[4:], (bytes32, bytes));
        bytes1 callType = ERC7579ModeLib.getCallType(mode);

        // Delegatecall — always blocked, can write arbitrary Safe storage
        if (callType == ERC7579ModeLib.CALLTYPE_DELEGATECALL) return true;

        // Single: packed encoding, target = first 20 bytes
        if (callType == ERC7579ModeLib.CALLTYPE_SINGLE) {
            if (execData.length < 20) return false;
            address target;
            assembly { target := shr(96, mload(add(execData, 32))) }
            return target == account;
        }

        // Batch: ABI-encoded Execution[] — block if ANY target == account
        if (callType == ERC7579ModeLib.CALLTYPE_BATCH) {
            Execution[] memory executions = abi.decode(execData, (Execution[]));
            for (uint256 i; i < executions.length; i++) {
                if (executions[i].target == account) return true;
            }
        }

        return false;
    }
}
