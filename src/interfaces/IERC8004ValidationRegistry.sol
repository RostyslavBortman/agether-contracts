// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC8004ValidationRegistry
 * @notice Interface for ERC-8004 Validation Registry
 * @dev Based on https://eips.ethereum.org/EIPS/eip-8004
 * 
 * This registry enables agents to request verification of their work and allows
 * validator smart contracts to provide responses that can be tracked on-chain.
 * 
 * Use cases:
 * - Code audits (KYA - Know Your Agent)
 * - TEE attestations
 * - zkML verifiers
 * - Stake-secured inference re-execution
 * 
 * Note: Official ERC-8004 ValidationRegistry is not yet deployed by ag0.
 *       This implementation follows the spec for future compatibility.
 * 
 * When deployed by ag0, addresses will likely follow the pattern:
 * - Mainnet:  0x8004C... (TBD)
 * - Sepolia:  0x8004C... (TBD)
 */
interface IERC8004ValidationRegistry {
    
    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Emitted when an agent requests validation
     * @param validatorAddress The address of the validator being requested
     * @param agentId The ERC-8004 agent ID
     * @param requestURI URI pointing to validation request data (IPFS/HTTP)
     * @param requestHash keccak256 hash commitment of the request payload
     */
    event ValidationRequest(
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestURI,
        bytes32 indexed requestHash
    );

    /**
     * @notice Emitted when a validator responds to a request
     * @param validatorAddress The validator who responded
     * @param agentId The ERC-8004 agent ID
     * @param requestHash The request being responded to
     * @param response Response score (0-100, where 0=fail, 100=pass)
     * @param responseURI URI pointing to validation evidence/report
     * @param responseHash Hash of the response content
     * @param tag Custom categorization (e.g., "code-audit", "tee-attestation")
     */
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                              FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Get the associated Identity Registry address
     * @return The IdentityRegistry contract address
     */
    function getIdentityRegistry() external view returns (address);

    /**
     * @notice Request validation from a validator
     * @dev MUST be called by the owner or operator of agentId
     * @param validatorAddress Address of the validator to request
     * @param agentId ERC-8004 agent ID
     * @param requestURI URI pointing to off-chain data for validation
     * @param requestHash keccak256 commitment to the request payload
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;

    /**
     * @notice Respond to a validation request
     * @dev MUST be called by the validatorAddress from the original request
     * @dev Can be called multiple times for progressive validation states
     * @param requestHash The request hash being responded to
     * @param response Score 0-100 (0=failed, 100=passed, intermediate for spectrum)
     * @param responseURI URI pointing to validation evidence (optional)
     * @param responseHash Hash of response content for integrity (optional for IPFS)
     * @param tag Custom categorization (optional)
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;

    /**
     * @notice Get validation status for a request
     * @param requestHash The request hash to query
     * @return validatorAddress The validator who responded
     * @return agentId The agent ID
     * @return response The response score (0-100)
     * @return tag The categorization tag
     * @return lastUpdate Timestamp of last update
     */
    function getValidationStatus(
        bytes32 requestHash
    ) external view returns (
        address validatorAddress,
        uint256 agentId,
        uint8 response,
        string memory tag,
        uint256 lastUpdate
    );

    /**
     * @notice Get aggregated validation statistics for an agent
     * @param agentId The agent ID to query
     * @param validatorAddresses Filter by validators (empty = all)
     * @param tag Filter by tag (empty = all)
     * @return count Number of validations matching filters
     * @return avgResponse Average response score
     */
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        string calldata tag
    ) external view returns (uint64 count, uint8 avgResponse);

    /**
     * @notice Get all validation request hashes for an agent
     * @param agentId The agent ID
     * @return requestHashes Array of request hashes
     */
    function getAgentValidations(
        uint256 agentId
    ) external view returns (bytes32[] memory requestHashes);

    /**
     * @notice Get all request hashes a validator has received
     * @param validatorAddress The validator address
     * @return requestHashes Array of request hashes
     */
    function getValidatorRequests(
        address validatorAddress
    ) external view returns (bytes32[] memory requestHashes);

    /**
     * @notice Check if agent's code is approved (convenience for KYA)
     * @dev Main function that credit providers / smart wallets should call
     * @param agentId The agent ID
     * @return True if agent has passing "code-audit" validation
     */
    function isAgentCodeApproved(uint256 agentId) external view returns (bool);
}
