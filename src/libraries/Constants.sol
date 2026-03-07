// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title Constants
 * @notice Shared constants for the Agether protocol
 */
library Constants {

    // ============ Math ============

    /// @notice Basis points denominator (100% = 10000)
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    // ============ Scoring ============

    /// @notice Maximum credit score
    uint256 internal constant MAX_SCORE = 1000;

    /// @notice Base credit score for new agents (no history)
    /// @dev New agents start at 300 — the floor. Not 0 (unusable) and not 500 (unearned).
    ///      300 is the traditional "thin file" starting point (cf. FICO 300-850 range).
    uint256 internal constant BASE_SCORE = 300;

    /// @notice ERC-8004 feedback tag 1
    string internal constant FEEDBACK_TAG1 = "credit";

    /// @notice ERC-8004 feedback tag 2
    string internal constant FEEDBACK_TAG2 = "agether";

    // ============ Oracle ============

    /// @notice Maximum age for oracle attestations (24 hours)
    uint256 internal constant MAX_ORACLE_AGE = 24 hours;

    // ============ Roles ============

    /// @notice Role for code auditing / validation
    bytes32 internal constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    // ============ ERC-4337 Validation ============

    /// @dev Signature is valid
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;

    /// @dev Signature is invalid
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    // ============ ERC-1271 ============

    /// @dev Magic value for valid signature
    bytes4 internal constant EIP1271_MAGIC = 0x1626ba7e;

    /// @dev Invalid signature
    bytes4 internal constant EIP1271_INVALID = 0xffffffff;

    // ============ Module Selectors (blocked by validator) ============

    /// @dev installModule(uint256,address,bytes) — verified: cast sig = 0x9517e29f
    bytes4 internal constant INSTALL_MODULE_SELECTOR = 0x9517e29f;

    /// @dev uninstallModule(uint256,address,bytes) — verified: cast sig = 0xa71763a8
    bytes4 internal constant UNINSTALL_MODULE_SELECTOR = 0xa71763a8;

    /// @dev execute(bytes32,bytes) — blocked to prevent wrapping install/uninstall inside execute
    bytes4 internal constant EXECUTE_SELECTOR = 0xe9ae5c53;

    /// @dev executeFromExecutor(bytes32,bytes) — blocked to prevent executor-path bypasses
    bytes4 internal constant EXECUTE_FROM_EXECUTOR_SELECTOR = 0xd691c964;

    // ============ Hook ============

    /// @notice Maximum number of sub-hooks (gas limit safety)
    uint256 internal constant MAX_HOOKS = 10;

    // ============ Factory ============

    /// @notice Sentinel owner for Safes — no one has the private key
    /// @dev Prevents execTransaction (native Safe path). All execution goes through 4337.
    ///      keccak256("agether.safe.sentinel.owner") truncated to address.
    address internal constant SENTINEL_OWNER = address(uint160(uint256(
        keccak256("agether.safe.sentinel.owner")
    )));
}
