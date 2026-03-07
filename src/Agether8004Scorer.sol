// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./interfaces/IERC8004.sol";
import "./interfaces/IAgether8004Scorer.sol";
import {IErrors as IA} from "./interfaces/IErrors.sol";
import {IEvents as IE} from "./interfaces/IEvents.sol";
import {Constants as C} from "./libraries/Constants.sol";

/**
 * @title Agether8004Scorer
 * @notice Oracle-based credit score store + ERC-8004 Reputation Registry bridge
 *
 * @dev Architecture:
 *
 *      1. Agent pays via x402 to request a credit score from the backend.
 *      2. Backend ML model computes the score off-chain.
 *      3. Backend signs (agentId, score, timestamp, chainId, contractAddress).
 *      4. Agent (or relayer) calls submitScore() with the signed attestation.
 *      5. Contract verifies signature, stores score, and pushes feedback
 *         to ERC-8004 Reputation Registry.
 *
 *      No on-chain scoring logic. The ML model is the brain.
 *      The contract is a verified score store with ERC-8004 integration.
 *
 *      Score range: 300 (thin file / new agent) to 1000 (perfect).
 */
contract Agether8004Scorer is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ State Variables ============

    /// @notice Oracle signer (backend address that signs score attestations)
    address public oracleSigner;

    /// @notice ERC-8004 Reputation Registry (for on-chain score publishing)
    IERC8004ReputationRegistry public erc8004Reputation;

    /// @notice Agent ID => latest score attestation
    mapping(uint256 => IAgether8004Scorer.ScoreAttestation) private _scores;

    // ============ Storage Gap ============

    uint256[47] private __gap;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    function initialize(address admin_) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // ============ Oracle Score Submission ============

    /**
     * @notice Submit a credit score from the off-chain ML model
     * @dev Flow: agent pays x402 → backend computes score → signs attestation →
     *      agent (or relayer) submits here. On success, pushes to ERC-8004.
     *
     *      Signature covers: keccak256(agentId, score, timestamp, chainId, contractAddress)
     *      This prevents cross-chain and cross-contract replay.
     *
     * @param agentId Agent ID (ERC-8004 token)
     * @param score_ Credit score from ML model (300-1000)
     * @param timestamp_ When the score was computed
     * @param signature ECDSA signature from oracleSigner
     */
    function submitScore(
        uint256 agentId,
        uint256 score_,
        uint256 timestamp_,
        bytes calldata signature
    ) external {
        if (oracleSigner == address(0)) revert IA.OracleSignerNotSet();
        if (score_ > C.MAX_SCORE) revert IA.AboveMaximum(score_, C.MAX_SCORE);
        if (score_ < C.BASE_SCORE) revert IA.BelowMinimum(score_, C.BASE_SCORE);

        // M-02 fix: reject future timestamps (prevents permanent score lock)
        if (timestamp_ > block.timestamp) {
            revert IA.OracleAttestationExpired(timestamp_, 0);
        }
        if (block.timestamp > timestamp_ + C.MAX_ORACLE_AGE) {
            revert IA.OracleAttestationExpired(timestamp_, C.MAX_ORACLE_AGE);
        }

        // Must be newer than existing attestation
        IAgether8004Scorer.ScoreAttestation storage existing = _scores[agentId];
        if (existing.timestamp > 0 && timestamp_ <= existing.timestamp) {
            revert IA.AlreadySet();
        }

        // Verify signature
        bytes32 messageHash = keccak256(abi.encode(
            agentId,
            score_,
            timestamp_,
            block.chainid,
            address(this)
        ));
        address signer = messageHash.toEthSignedMessageHash().recover(signature);

        if (signer != oracleSigner) {
            revert IA.InvalidOracleSignature();
        }

        // Store attestation
        _scores[agentId] = IAgether8004Scorer.ScoreAttestation({
            score: score_,
            timestamp: timestamp_,
            signer: signer
        });

        emit IE.ScoreUpdated(agentId, score_, timestamp_, signer);

        // Push to ERC-8004 Reputation Registry
        _publishToERC8004(agentId, score_);
    }

    // ============ View Functions ============

    /// @notice Get agent's current credit score (returns BASE_SCORE if none submitted)
    function getCreditScore(uint256 agentId) external view returns (uint256) {
        IAgether8004Scorer.ScoreAttestation storage att = _scores[agentId];
        if (att.timestamp == 0) return C.BASE_SCORE;
        return att.score;
    }

    /// @notice Get the full attestation for an agent
    function getAttestation(uint256 agentId) external view returns (IAgether8004Scorer.ScoreAttestation memory) {
        return _scores[agentId];
    }

    /// @notice Check if agent is eligible for credit based on score
    function isEligible(
        uint256 agentId,
        uint256 minScore
    ) external view returns (bool eligible, uint256 currentScore) {
        IAgether8004Scorer.ScoreAttestation storage att = _scores[agentId];
        currentScore = att.timestamp == 0 ? C.BASE_SCORE : att.score;
        eligible = currentScore >= minScore;
    }

    /// @notice Check if score is still fresh (within MAX_ORACLE_AGE)
    function isScoreFresh(uint256 agentId) external view returns (bool fresh, uint256 age) {
        IAgether8004Scorer.ScoreAttestation storage att = _scores[agentId];
        if (att.timestamp == 0) return (false, type(uint256).max);
        age = block.timestamp - att.timestamp;
        fresh = age <= C.MAX_ORACLE_AGE;
    }

    // ============ Admin Functions ============

    /// @notice Set the oracle signer address (backend that signs score attestations)
    function setOracleSigner(address signer_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer_ == address(0)) revert IA.ZeroAddress();
        address old = oracleSigner;
        oracleSigner = signer_;
        emit IE.OracleSignerUpdated(old, signer_);
    }

    /// @notice Set ERC-8004 Reputation Registry address
    function setERC8004ReputationRegistry(address registry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = address(erc8004Reputation);
        erc8004Reputation = IERC8004ReputationRegistry(registry_);
        emit IE.RegistryUpdated(old, registry_);
    }

    // ============ Internal Functions ============

    /**
     * @notice Push score update to ERC-8004 Reputation Registry
     * @dev Maps score to feedback value:
     *      score >= 700 → +10 (good)
     *      score >= 500 → +5  (neutral-good)
     *      score >= 400 → -5  (neutral-bad)
     *      score <  400 → -10 (bad)
     */
    function _publishToERC8004(uint256 agentId, uint256 score_) internal {
        if (address(erc8004Reputation) == address(0)) return;

        int128 feedbackValue;
        if (score_ >= 700) {
            feedbackValue = 10;
        } else if (score_ >= 500) {
            feedbackValue = 5;
        } else if (score_ >= 400) {
            feedbackValue = -5;
        } else {
            feedbackValue = -10;
        }

        try erc8004Reputation.giveFeedback(
            agentId,
            feedbackValue,
            0,                  // valueDecimals
            C.FEEDBACK_TAG1,
            C.FEEDBACK_TAG2,
            "agether-credit",   // endpoint
            "",                 // feedbackURI
            bytes32(0)          // feedbackHash
        ) {
            emit IE.ERC8004FeedbackPublished(agentId, feedbackValue, C.FEEDBACK_TAG1, C.FEEDBACK_TAG2);
        } catch Error(string memory reason) {
            emit IE.ERC8004FeedbackFailed(agentId, reason);
        } catch {
            emit IE.ERC8004FeedbackFailed(agentId, "unknown");
        }
    }

    // ============ UUPS ============

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newImplementation == address(0)) revert IA.ZeroAddress();
        if (newImplementation.code.length == 0) revert IA.InvalidRegistryAddress(); // not a contract
    }
}
