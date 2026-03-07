// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
// Hardhat needs an import in sources to compile OZ contracts into artifacts.
import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title MockAgentRegistry
 * @notice Mock ERC-8004 Identity Registry for testing
 * @dev Simplified version that supports register() and ownership
 */
contract MockAgentRegistry is ERC721 {
    uint256 private _nextId = 1;

    constructor() ERC721("Agent Registry", "AGENT") {}

    /**
     * @notice Register a new agent (ERC-8004 style)
     * @return agentId New agent ID
     */
    function register() external returns (uint256 agentId) {
        agentId = _nextId++;
        _mint(msg.sender, agentId);
    }

    /**
     * @notice Register with URI (ERC-8004 style)
     * @param agentURI URI for agent metadata
     * @return agentId New agent ID
     */
    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextId++;
        _mint(msg.sender, agentId);
        // Note: URI not stored in mock
    }

    /**
     * @notice Get next ID (for testing)
     */
    function nextId() external view returns (uint256) {
        return _nextId;
    }
}
