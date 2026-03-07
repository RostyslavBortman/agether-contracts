// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "../interfaces/IERC8004ValidationRegistry.sol";
import {IErrors as IA} from "../interfaces/IErrors.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title ValidationRegistry
 * @notice ERC-8004 compliant Validation Registry for agent code audits (KYA)
 * @dev Implements IERC8004ValidationRegistry interface
 * 
 * This contract enables:
 * - Agents to request code audits from validators
 * - Validators to approve/reject code with on-chain proof
 * - Credit providers to check validation status before lending
 * 
 * When ag0 deploys the official ValidationRegistry, this can be deprecated
 * or used as a wrapper/extension for credit-specific validations.
 * 
 * Common tags:
 * - "code-audit": KYA code review
 * - "security-audit": Security-focused review
 * - "tee-attestation": TEE verification
 * - "zkml-proof": zkML verification
 */
contract ValidationRegistry is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    IERC8004ValidationRegistry
{
    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Response scores
    uint8 public constant RESPONSE_FAILED = 0;
    uint8 public constant RESPONSE_PASSED = 100;
    
    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct ValidationRecord {
        address validatorAddress;
        uint256 agentId;
        string requestURI;
        uint8 response;
        string responseURI;
        bytes32 responseHash;
        string tag;
        uint256 requestedAt;
        uint256 respondedAt;
        bool hasResponse;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STORAGE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice ERC-8004 Identity Registry (ERC-721 compatible)
    IERC721 private _identityRegistry;

    /// @notice Request hash => ValidationRecord
    mapping(bytes32 => ValidationRecord) private _validations;

    /// @notice Agent ID => array of request hashes
    mapping(uint256 => bytes32[]) private _agentValidations;

    /// @notice Validator address => array of request hashes
    mapping(address => bytes32[]) private _validatorRequests;

    /// @notice Agent ID => tag => latest passing request hash (for quick lookup)
    mapping(uint256 => mapping(string => bytes32)) private _latestPassing;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STORAGE GAP
    // ═══════════════════════════════════════════════════════════════════════

    uint256[44] private __gap;

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              INITIALIZER
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize the ValidationRegistry
     * @param identityRegistry_ ERC-8004 Identity Registry address
     * @param admin_ Default admin address
     */
    function initialize(
        address identityRegistry_,
        address admin_
    ) external initializer {
        if (identityRegistry_ == address(0)) revert IA.ZeroAddress();
        if (admin_ == address(0)) revert IA.ZeroAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _identityRegistry = IERC721(identityRegistry_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(VALIDATOR_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         IERC8004ValidationRegistry
    // ═══════════════════════════════════════════════════════════════════════

    /// @inheritdoc IERC8004ValidationRegistry
    function getIdentityRegistry() external view override returns (address) {
        return address(_identityRegistry);
    }

    /// @inheritdoc IERC8004ValidationRegistry
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external override whenNotPaused {
        if (validatorAddress == address(0)) revert IA.ZeroAddress();
        if (requestHash == bytes32(0)) revert IA.EmptyRequestHash();

        // Prevent duplicate request hashes (hash collision / replay)
        if (_validations[requestHash].validatorAddress != address(0)) {
            revert IA.RequestAlreadyExists(requestHash);
        }

        // Verify caller is agent owner or operator
        address owner = _identityRegistry.ownerOf(agentId);
        bool isApproved = _identityRegistry.isApprovedForAll(owner, msg.sender);
        if (msg.sender != owner && !isApproved) {
            revert IA.NotAgentOwnerOrOperator(agentId, msg.sender);
        }

        // Store the request
        ValidationRecord storage record = _validations[requestHash];
        record.validatorAddress = validatorAddress;
        record.agentId = agentId;
        record.requestURI = requestURI;
        record.requestedAt = block.timestamp;
        record.hasResponse = false;

        // Track by agent and validator
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);

        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    /// @inheritdoc IERC8004ValidationRegistry
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external override whenNotPaused {
        ValidationRecord storage record = _validations[requestHash];
        
        // Check request exists
        if (record.validatorAddress == address(0)) {
            revert IA.RequestNotFound(requestHash);
        }

        // Check caller is the requested validator OR has VALIDATOR_ROLE
        if (msg.sender != record.validatorAddress && !hasRole(VALIDATOR_ROLE, msg.sender)) {
            revert IA.NotRequestedValidator(requestHash, msg.sender);
        }

        // Validate response range
        if (response > 100) {
            revert IA.InvalidResponse(response);
        }

        // Update record
        record.response = response;
        record.responseURI = responseURI;
        record.responseHash = responseHash;
        record.tag = tag;
        record.respondedAt = block.timestamp;
        record.hasResponse = true;

        // Track latest passing validation for quick lookup
        if (response >= RESPONSE_PASSED) {
            _latestPassing[record.agentId][tag] = requestHash;
        }

        emit ValidationResponse(
            msg.sender,
            record.agentId,
            requestHash,
            response,
            responseURI,
            responseHash,
            tag
        );
    }

    /// @inheritdoc IERC8004ValidationRegistry
    function getValidationStatus(
        bytes32 requestHash
    ) external view override returns (
        address validatorAddress,
        uint256 agentId,
        uint8 response,
        string memory tag,
        uint256 lastUpdate
    ) {
        ValidationRecord storage record = _validations[requestHash];
        return (
            record.validatorAddress,
            record.agentId,
            record.response,
            record.tag,
            record.hasResponse ? record.respondedAt : record.requestedAt
        );
    }

    /// @inheritdoc IERC8004ValidationRegistry
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        string calldata tag
    ) external view override returns (uint64 count, uint8 avgResponse) {
        bytes32[] storage hashes = _agentValidations[agentId];
        
        uint256 total = 0;
        uint256 sumResponse = 0;
        bool filterByValidator = validatorAddresses.length > 0;
        bool filterByTag = bytes(tag).length > 0;

        for (uint256 i = 0; i < hashes.length; i++) {
            ValidationRecord storage record = _validations[hashes[i]];
            
            // Skip if no response yet
            if (!record.hasResponse) continue;

            // Filter by validator if specified
            if (filterByValidator) {
                bool found = false;
                for (uint256 j = 0; j < validatorAddresses.length; j++) {
                    if (record.validatorAddress == validatorAddresses[j]) {
                        found = true;
                        break;
                    }
                }
                if (!found) continue;
            }

            // Filter by tag if specified
            if (filterByTag && keccak256(bytes(record.tag)) != keccak256(bytes(tag))) {
                continue;
            }

            total++;
            sumResponse += record.response;
        }

        count = uint64(total);
        avgResponse = total > 0 ? uint8(sumResponse / total) : 0;
    }

    /// @inheritdoc IERC8004ValidationRegistry
    function getAgentValidations(
        uint256 agentId
    ) external view override returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    /// @inheritdoc IERC8004ValidationRegistry
    function getValidatorRequests(
        address validatorAddress
    ) external view override returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         CREDIT-SPECIFIC HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Check if agent has a passing validation for a specific tag
     * @param agentId The agent ID
     * @param tag The validation tag (e.g., "code-audit")
     * @return hasPassing Whether agent has a passing validation
     * @return requestHash The latest passing request hash
     */
    function hasPassingValidation(
        uint256 agentId,
        string calldata tag
    ) external view returns (bool hasPassing, bytes32 requestHash) {
        requestHash = _latestPassing[agentId][tag];
        if (requestHash != bytes32(0)) {
            ValidationRecord storage record = _validations[requestHash];
            hasPassing = record.hasResponse && record.response >= RESPONSE_PASSED;
        }
    }

    /**
     * @notice Check if agent's code is approved (convenience for KYA)
     * @dev This is the main function credit providers should call
     * @param agentId The agent ID
     * @return True if agent has passing "code-audit" validation
     */
    function isAgentCodeApproved(uint256 agentId) external view returns (bool) {
        bytes32 requestHash = _latestPassing[agentId]["code-audit"];
        if (requestHash == bytes32(0)) return false;
        
        ValidationRecord storage record = _validations[requestHash];
        return record.hasResponse && record.response >= RESPONSE_PASSED;
    }

    /**
     * @notice Get the code hash from the latest code-audit validation
     * @param agentId The agent ID
     * @return codeHash The approved code hash (requestHash serves as codeHash)
     * @return approved Whether it's approved
     */
    function getApprovedCodeHash(
        uint256 agentId
    ) external view returns (bytes32 codeHash, bool approved) {
        codeHash = _latestPassing[agentId]["code-audit"];
        if (codeHash != bytes32(0)) {
            ValidationRecord storage record = _validations[codeHash];
            approved = record.hasResponse && record.response >= RESPONSE_PASSED;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Add a validator
     * @param validator The validator address to add
     */
    function addValidator(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @notice Remove a validator
     * @param validator The validator address to remove
     */
    function removeValidator(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(VALIDATOR_ROLE, validator);
    }

    /**
     * @notice Pause the contract
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              UUPS
    // ═══════════════════════════════════════════════════════════════════════

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newImplementation == address(0)) revert IA.ZeroAddress();
        if (newImplementation.code.length == 0) revert IA.InvalidRegistryAddress();
    }
}
