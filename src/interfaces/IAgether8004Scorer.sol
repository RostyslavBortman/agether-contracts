// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IAgether8004Scorer
 * @notice Interface for on-chain AI agent credit scoring
 * @dev All credit scoring happens off-chain via ML model.
 *      Agents pay via x402 to request a score from the backend.
 *      Backend computes score, signs attestation, agent submits on-chain.
 *      On score update, feedback is pushed to ERC-8004 Reputation Registry.
 *
 *      Score range: 300 (thin file floor) to 1000 (perfect)
 *
 *      Flow:
 *      1. Agent pays x402 to backend for credit score
 *      2. Backend ML model computes score off-chain
 *      3. Backend signs (agentId, score, timestamp, chainId, contractAddress)
 *      4. Agent calls submitScore() with signed attestation
 *      5. Contract verifies signature, stores score, pushes to ERC-8004
 */
interface IAgether8004Scorer {

    // ============ Structs ============

    /// @notice Score attestation from the off-chain ML oracle
    struct ScoreAttestation {
        uint256 score;       // Credit score (300-1000)
        uint256 timestamp;   // When the score was computed off-chain
        address signer;      // Oracle signer who signed the attestation
    }

    // ============ Oracle Functions ============

    /// @notice Submit a score from the off-chain ML model
    /// @dev Agent pays via x402, backend computes score, signs attestation.
    ///      Anyone can relay the signed attestation on-chain.
    ///      On success, pushes feedback to ERC-8004 Reputation Registry.
    /// @param agentId Agent ID (ERC-8004 token)
    /// @param score Credit score (300-1000)
    /// @param timestamp When the score was computed
    /// @param signature ECDSA signature from oracleSigner
    function submitScore(
        uint256 agentId,
        uint256 score,
        uint256 timestamp,
        bytes calldata signature
    ) external;

    // ============ View Functions ============

    /// @notice Get agent's current credit score
    /// @param agentId Agent ID
    /// @return score Current score (300 if no score submitted yet)
    function getCreditScore(uint256 agentId) external view returns (uint256 score);

    /// @notice Get the full attestation data for an agent
    /// @param agentId Agent ID
    /// @return attestation The latest score attestation
    function getAttestation(uint256 agentId) external view returns (ScoreAttestation memory attestation);

    /// @notice Check if agent is eligible for credit based on score
    /// @param agentId Agent ID
    /// @param minScore Minimum required score
    /// @return eligible Whether score >= minScore
    /// @return currentScore The agent's current score
    function isEligible(
        uint256 agentId,
        uint256 minScore
    ) external view returns (bool eligible, uint256 currentScore);

    /// @notice Check if score is still fresh (within MAX_ORACLE_AGE)
    /// @param agentId Agent ID
    /// @return fresh Whether the score is still valid
    /// @return age Seconds since the score was computed
    function isScoreFresh(uint256 agentId) external view returns (bool fresh, uint256 age);

    /// @notice Get oracle signer address
    function oracleSigner() external view returns (address);

    // ============ Admin Functions ============

    /// @notice Set the oracle signer address (backend wallet)
    function setOracleSigner(address signer) external;

    /// @notice Set ERC-8004 Reputation Registry address
    function setERC8004ReputationRegistry(address registry) external;
}
