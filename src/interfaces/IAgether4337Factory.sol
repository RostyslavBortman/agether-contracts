// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IAgether4337Factory
 * @notice Interface for the Safe-based agent account factory
 * @dev Each agent (ERC-8004 NFT) gets a Safe account configured with:
 *      - Safe7579 adapter (ERC-7579 module support + ERC-4337)
 *      - Agether8004ValidationModule (ownership + KYA + module lock)
 *      - AgetherHookMultiplexer (admin-managed hooks)
 *      - Sentinel owner (no execTransaction — 4337 only)
 */
interface IAgether4337Factory {

    // ============ View Functions ============

    /// @notice Get the Safe account address for an agent
    /// @param agentId The ERC-8004 agent token ID
    /// @return The Safe account address (address(0) if not created)
    function getAccount(uint256 agentId) external view returns (address);

    /// @notice Check if an account exists for an agent
    /// @param agentId The ERC-8004 agent token ID
    /// @return True if an account has been created
    function accountExists(uint256 agentId) external view returns (bool);

    /// @notice Get agent ID for a Safe account address (reverse lookup)
    /// @param account The Safe account address
    /// @return The agent ID (0 if not found)
    function getAgentId(address account) external view returns (uint256);

    /// @notice Total accounts created
    /// @return The number of accounts created so far
    function totalAccounts() external view returns (uint256);

    /// @notice Get agent ID by index in the ordered list
    /// @param index The index (0-based)
    /// @return The agent ID at that index
    function getAgentIdByIndex(uint256 index) external view returns (uint256);

    /// @notice Get all agent IDs with accounts
    /// @return Ordered array of agent IDs
    function getAllAgentIds() external view returns (uint256[] memory);

    // ============ Immutables ============

    /// @notice Safe singleton (implementation) address
    function safeSingleton() external view returns (address);

    /// @notice Safe7579 adapter singleton address
    function safe7579() external view returns (address);

    /// @notice Bootstrap contract for Safe7579 initialization
    function bootstrap() external view returns (address);

    /// @notice Current validation module address (used for NEW accounts)
    function validationModule() external view returns (address);

    /// @notice Current hook multiplexer address (used for NEW accounts)
    function hookMultiplexer() external view returns (address);

    // ============ Factory Functions ============

    /// @notice Create a Safe account for an agent
    /// @dev Only the ERC-8004 NFT owner can create the account.
    ///      The Safe address is deterministic (based on agentId + chainId).
    /// @param agentId The ERC-8004 agent token ID
    /// @return safeAccount The new Safe account address
    function createAccount(uint256 agentId) external returns (address safeAccount);

    // ============ Admin Functions ============

    /// @notice Update the validation module for NEW accounts
    /// @dev Only affects accounts created after this call. Existing accounts are immutable.
    /// @param newModule The new ERC8004ValidationModule address
    function setValidationModule(address newModule) external;

    /// @notice Update the hook multiplexer for NEW accounts
    /// @dev Only affects accounts created after this call. Existing accounts are immutable.
    /// @param newHook The new HookMultiplexer address
    function setHookMultiplexer(address newHook) external;
}
