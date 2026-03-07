// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title IERC8004IdentityRegistry
 * @notice Interface for ERC-8004 Identity Registry (real spec)
 * @dev Based on https://eips.ethereum.org/EIPS/eip-8004
 * @dev Source: https://github.com/erc-8004/erc-8004-contracts
 * 
 * Contract addresses:
 * - Mainnet:  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 * - Sepolia:  0x8004A818BFB912233c491871b3d84c89A494BD9e
 * - Base:     0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 */
interface IERC8004IdentityRegistry is IERC721 {
    
    struct MetadataEntry {
        string key;
        bytes value;
    }
    
    // ============ Registration Functions ============
    
    /**
     * @notice Register a new agent (minimal)
     * @return agentId New agent ID
     */
    function register() external returns (uint256 agentId);
    
    /**
     * @notice Register with URI
     * @param agentURI IPFS/HTTP URI to agent metadata JSON
     * @return agentId New agent ID
     */
    function register(string calldata agentURI) external returns (uint256 agentId);
    
    /**
     * @notice Register with URI and metadata
     * @param agentURI IPFS/HTTP URI to agent metadata JSON
     * @param metadata On-chain metadata entries
     * @return agentId New agent ID
     */
    function register(
        string calldata agentURI, 
        MetadataEntry[] calldata metadata
    ) external returns (uint256 agentId);
    
    // ============ Management Functions ============
    
    /**
     * @notice Update agent URI
     * @param agentId Agent ID
     * @param newURI New URI
     */
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    
    /**
     * @notice Set on-chain metadata
     * @param agentId Agent ID
     * @param metadataKey Key (e.g., "x402Support")
     * @param metadataValue Value as bytes
     */
    function setMetadata(
        uint256 agentId, 
        string calldata metadataKey, 
        bytes calldata metadataValue
    ) external;
    
    /**
     * @notice Get on-chain metadata
     * @param agentId Agent ID
     * @param metadataKey Key
     * @return value Metadata value
     */
    function getMetadata(
        uint256 agentId, 
        string calldata metadataKey
    ) external view returns (bytes memory value);
}

/**
 * @title IERC8004ReputationRegistry  
 * @notice Interface for ERC-8004 Reputation Registry
 * @dev Source: https://github.com/erc-8004/erc-8004-contracts
 * 
 * Contract addresses:
 * - Mainnet:  0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 * - Sepolia:  0x8004B663056A597Dffe9eCcC1965A193B7388713
 * - Base:     0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 */
interface IERC8004ReputationRegistry {
    
    /**
     * @notice Give feedback to an agent
     */
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
    
    /**
     * @notice Revoke feedback
     */
    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;
    
    /**
     * @notice Read specific feedback
     */
    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (
        int128 value,
        uint8 valueDecimals,
        string memory tag1,
        string memory tag2,
        bool isRevoked
    );
    
    /**
     * @notice Get reputation summary
     */
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (
        uint64 count,
        int128 summaryValue,
        uint8 summaryValueDecimals
    );
    
    /**
     * @notice Get all clients who gave feedback
     */
    function getClients(uint256 agentId) external view returns (address[] memory);
    
    /**
     * @notice Get identity registry address
     */
    function getIdentityRegistry() external view returns (address);
}

// Alias for backward compatibility
// "IERC8004" refers to the Identity Registry (main ERC-8004 contract)
interface IERC8004 is IERC8004IdentityRegistry {}

// Note: IERC8004ValidationRegistry is defined in IERC8004ValidationRegistry.sol
// with a more complete implementation
