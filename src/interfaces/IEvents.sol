// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IEvents
 * @notice Shared events for the Agether protocol
 * @dev Usage: import {IEvents as IE} from "./interfaces/IEvents.sol";
 *      Then: emit IE.ScoreSubmitted(...);
 */
interface IEvents {

    // ============ Agether8004Scorer Events ============

    /// @notice Emitted when a credit score is submitted on-chain
    event ScoreSubmitted(
        uint256 indexed agentId,
        uint256 score,
        uint256 timestamp,
        address indexed signer
    );

    /// @notice Emitted when a credit score is updated (alias used by scorer)
    event ScoreUpdated(
        uint256 indexed agentId,
        uint256 score,
        uint256 timestamp,
        address indexed signer
    );

    /// @notice Emitted when the oracle signer is updated
    event OracleSignerUpdated(
        address indexed oldSigner,
        address indexed newSigner
    );

    /// @notice Emitted when the ERC-8004 Reputation Registry is updated
    event RegistryUpdated(
        address indexed oldRegistry,
        address indexed newRegistry
    );

    /// @notice Emitted when feedback is published to ERC-8004 Reputation Registry
    event ERC8004FeedbackPublished(
        uint256 indexed agentId,
        int128 value,
        string tag1,
        string tag2
    );

    /// @notice Emitted when ERC-8004 feedback fails
    event ERC8004FeedbackFailed(
        uint256 indexed agentId,
        string reason
    );

    // ============ Agether8004ValidationModule Events ============

    /// @notice Emitted when the validation module is installed for an account
    event ModuleInstalled(
        address indexed account,
        address indexed registry,
        uint256 indexed agentId
    );

    /// @notice Emitted when the validation registry is updated
    event ValidationRegistryUpdated(
        address indexed oldRegistry,
        address indexed newRegistry
    );

    // ============ AgetherHookMultiplexer Events ============

    /// @notice Emitted when a sub-hook is added
    event SubHookAdded(address indexed hook, uint256 totalHooks);

    /// @notice Emitted when a sub-hook is removed
    event SubHookRemoved(address indexed hook, uint256 totalHooks);

    // ============ Agether4337Factory Events ============

    /// @notice Emitted when a new agent account is created
    event AccountCreated(
        uint256 indexed agentId,
        address indexed safeAccount,
        address indexed owner
    );

    /// @notice Emitted when the validation module address is updated
    event ValidationModuleUpdated(address indexed oldModule, address indexed newModule);

    /// @notice Emitted when the hook multiplexer address is updated
    event HookMultiplexerUpdated(address indexed oldHook, address indexed newHook);

    // ============ Legacy ============

    /// @notice Emitted when the ERC-8004 Reputation Registry is updated (legacy name)
    event ReputationRegistryUpdated(
        address indexed oldRegistry,
        address indexed newRegistry
    );
}
