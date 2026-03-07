// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "./interfaces/IAgether4337Factory.sol";
import "./interfaces/ISafe.sol";
import "./interfaces/ISafe7579.sol";
import "./interfaces/IERC8004.sol";
import "./interfaces/IAgether7579Bootstrap.sol";
import {IErrors as IA} from "./interfaces/IErrors.sol";
import {IEvents as IE} from "./interfaces/IEvents.sol";
import {Constants as C} from "./libraries/Constants.sol";

/**
 * @title Agether4337Factory
 * @notice Factory for deploying Safe-based agent accounts with ERC-7579 modules
 * @dev Each agent (ERC-8004 NFT) gets a Safe account configured with:
 *      - Safe7579 adapter (ERC-7579 module support + ERC-4337)
 *      - Agether8004ValidationModule (ownership + KYA + module lock)
 *      - AgetherHookMultiplexer (admin-managed hooks)
 *      - Sentinel owner (no execTransaction — 4337 only)
 *
 *      Architecture:
 *      ┌──────────────────────┐     ┌──────────────────┐
 *      │ Agether4337Factory   │────▶│ SafeProxyFactory  │
 *      └──────────────────────┘     │ (pre-deployed)    │
 *              │                    └────────┬─────────┘
 *              │                             │
 *              │                             ▼
 *              │                    ┌──────────────────┐
 *              │                    │   Safe Proxy      │
 *              │                    │   ┌────────────┐  │
 *              │                    │   │ Safe7579   │  │ (module + fallback handler)
 *              │                    │   │  ├ Validator│  │ (Agether8004ValidationModule)
 *              │                    │   │  └ Hook    │  │ (AgetherHookMultiplexer)
 *              │                    │   └────────────┘  │
 *              │                    └──────────────────┘
 *              │
 *              ▼
 *      ┌────────────────────────┐
 *      │ Agether7579Bootstrap   │ (delegatecalled during Safe.setup)
 *      └────────────────────────┘
 *
 *      Safe owner is a sentinel address (no one can use execTransaction).
 *      ALL execution goes through ERC-4337 EntryPoint → Safe7579 → our validator.
 *
 *      Governance:
 *      - Factory owner = TimelockController
 *      - Can update validator/hook addresses for NEW accounts
 *      - Cannot change existing accounts (immutable after creation)
 */
contract Agether4337Factory is IAgether4337Factory, Initializable, OwnableUpgradeable, UUPSUpgradeable {

    // ═══════════════════════════════════════════════════════════════════════
    //                              STORAGE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Safe singleton (implementation)
    address public safeSingleton;

    /// @notice Safe proxy factory
    ISafeProxyFactory public safeProxyFactory;

    /// @notice Safe7579 adapter singleton
    address public safe7579;

    /// @notice Bootstrap contract for Safe7579 initialization
    address public bootstrap;

    /// @notice ERC-8004 Identity Registry
    IERC8004 public identityRegistry;

    /// @notice ERC8004ValidationModule — installed as validator on every Safe
    address public validationModule;

    /// @notice HookMultiplexer — installed as hook on every Safe
    address public hookMultiplexer;

    /// @notice agentId => Safe account address
    mapping(uint256 => address) private _accounts;

    /// @notice Safe account => agentId (reverse lookup)
    mapping(address => uint256) private _accountToAgent;

    /// @notice Ordered list of all agent IDs with accounts
    uint256[] private _agentIds;

    /// @notice Total accounts created
    uint256 private _totalAccounts;

    // ═══════════════════════════════════════════════════════════════════════
    //                           STORAGE GAP
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Reserved storage for future upgrades
    uint256[39] private __gap;

    // ═══════════════════════════════════════════════════════════════════════
    //                            CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Disable initializers on the implementation contract
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                            INITIALIZER
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize the Agether4337Factory (called once via proxy)
     * @param safeSingleton_ Safe v1.4.1 singleton address
     * @param safeProxyFactory_ Safe proxy factory address
     * @param safe7579_ Safe7579 adapter singleton address
     * @param bootstrap_ Agether7579Bootstrap contract address
     * @param identityRegistry_ ERC-8004 Identity Registry address
     * @param validationModule_ Agether8004ValidationModule address
     * @param hookMultiplexer_ AgetherHookMultiplexer address
     * @param owner_ Factory owner (should be TimelockController)
     */
    function initialize(
        address safeSingleton_,
        address safeProxyFactory_,
        address safe7579_,
        address bootstrap_,
        address identityRegistry_,
        address validationModule_,
        address hookMultiplexer_,
        address owner_
    ) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();

        if (safeSingleton_ == address(0)) revert IA.ZeroAddress();
        if (safeProxyFactory_ == address(0)) revert IA.ZeroAddress();
        if (safe7579_ == address(0)) revert IA.ZeroAddress();
        if (bootstrap_ == address(0)) revert IA.ZeroAddress();
        if (identityRegistry_ == address(0)) revert IA.ZeroAddress();
        if (validationModule_ == address(0)) revert IA.ZeroAddress();
        if (hookMultiplexer_ == address(0)) revert IA.ZeroAddress();

        safeSingleton = safeSingleton_;
        safeProxyFactory = ISafeProxyFactory(safeProxyFactory_);
        safe7579 = safe7579_;
        bootstrap = bootstrap_;
        identityRegistry = IERC8004(identityRegistry_);
        validationModule = validationModule_;
        hookMultiplexer = hookMultiplexer_;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                           VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Get the Safe account address for an agent
    function getAccount(uint256 agentId) external view returns (address) {
        return _accounts[agentId];
    }

    /// @notice Check if an account exists for an agent
    function accountExists(uint256 agentId) external view returns (bool) {
        return _accounts[agentId] != address(0);
    }

    /// @notice Get agent ID for a Safe account address
    function getAgentId(address account) external view returns (uint256) {
        return _accountToAgent[account];
    }

    /// @notice Total accounts created
    function totalAccounts() external view returns (uint256) {
        return _totalAccounts;
    }

    /// @notice Get agent ID by index
    function getAgentIdByIndex(uint256 index) external view returns (uint256) {
        require(index < _agentIds.length, "Index out of bounds");
        return _agentIds[index];
    }

    /// @notice Get all agent IDs
    function getAllAgentIds() external view returns (uint256[] memory) {
        return _agentIds;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         FACTORY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a Safe account for an agent
     * @dev Deploys a new Safe proxy via SafeProxyFactory with:
     *      - Sentinel owner (no execTransaction possible)
     *      - Safe7579 as module + fallback handler
     *      - ERC8004ValidationModule as the sole validator
     *      - HookMultiplexer as the sole hook
     *
     *      Only the ERC-8004 NFT owner can create the account.
     *      The Safe address is deterministic (based on agentId).
     *
     * @param agentId The ERC-8004 agent token ID
     * @return safeAccount The new Safe account address
     */
    function createAccount(uint256 agentId) external returns (address safeAccount) {
        // Check if account already exists
        if (_accounts[agentId] != address(0)) {
            revert IA.AccountAlreadyExists(agentId, _accounts[agentId]);
        }

        // Verify caller owns the agent NFT
        address agentOwner = identityRegistry.ownerOf(agentId);
        if (msg.sender != agentOwner) {
            revert IA.NotAgentNFTOwner(agentId, msg.sender, agentOwner);
        }

        // Build Safe.setup() calldata
        bytes memory setupData = _buildSetupData(agentId);

        // Deploy Safe proxy via factory (deterministic address)
        uint256 saltNonce = uint256(keccak256(abi.encodePacked(agentId, block.chainid)));
        safeAccount = safeProxyFactory.createProxyWithNonce(
            safeSingleton,
            setupData,
            saltNonce
        );

        // Store mappings
        _accounts[agentId] = safeAccount;
        _accountToAgent[safeAccount] = agentId;
        _agentIds.push(agentId);
        _totalAccounts++;

        emit IE.AccountCreated(agentId, safeAccount, agentOwner);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Update the validation module for NEW accounts
     * @dev Only affects accounts created after this call. Existing accounts are immutable.
     * @param newModule The new ERC8004ValidationModule address
     */
    function setValidationModule(address newModule) external onlyOwner {
        if (newModule == address(0)) revert IA.ZeroAddress();
        address old = validationModule;
        validationModule = newModule;
        emit IE.ValidationModuleUpdated(old, newModule);
    }

    /**
     * @notice Update the hook multiplexer for NEW accounts
     * @dev Only affects accounts created after this call. Existing accounts are immutable.
     * @param newHook The new HookMultiplexer address
     */
    function setHookMultiplexer(address newHook) external onlyOwner {
        if (newHook == address(0)) revert IA.ZeroAddress();
        address old = hookMultiplexer;
        hookMultiplexer = newHook;
        emit IE.HookMultiplexerUpdated(old, newHook);
    }

    /**
     * @notice Authorize a UUPS upgrade — only callable by owner (TimelockController)
     * @param newImplementation The new implementation address
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        if (newImplementation == address(0)) revert IA.ZeroAddress();
        if (newImplementation.code.length == 0) revert IA.ZeroAddress();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @dev Build the Safe.setup() calldata with Safe7579 bootstrap
     *
     *      Safe.setup(
     *          owners:          [SENTINEL_OWNER]     — no real owner
     *          threshold:       1
     *          to:              bootstrap             — delegatecall target
     *          data:            bootstrap.initSafe7579(...)
     *          fallbackHandler: safe7579              — routes 7579 calls
     *          paymentToken:    address(0)            — no payment
     *          payment:         0
     *          paymentReceiver: address(0)
     *      )
     */
    function _buildSetupData(uint256 agentId) internal view returns (bytes memory) {
        // Owners array: just the sentinel
        address[] memory owners = new address[](1);
        owners[0] = C.SENTINEL_OWNER;

        // Build bootstrap data
        bytes memory bootstrapData = _buildBootstrapData(agentId);

        return abi.encodeCall(
            ISafe.setup,
            (
                owners,
                1,                // threshold
                bootstrap,        // to: delegatecall target
                bootstrapData,    // data: bootstrap.initSafe7579(...)
                safe7579,         // fallbackHandler
                address(0),       // paymentToken
                0,                // payment
                payable(address(0)) // paymentReceiver
            )
        );
    }

    /**
     * @dev Build the bootstrap.initSafe7579() calldata
     */
    function _buildBootstrapData(uint256 agentId) internal view returns (bytes memory) {
        // Validators array: just ERC8004ValidationModule
        ISafe7579.ModuleInit[] memory validators = new ISafe7579.ModuleInit[](1);
        validators[0] = ISafe7579.ModuleInit({
            module: validationModule,
            initData: abi.encode(address(identityRegistry), agentId)
        });

        // Executors: none
        ISafe7579.ModuleInit[] memory executors = new ISafe7579.ModuleInit[](0);

        // Fallbacks: none
        ISafe7579.ModuleInit[] memory fallbacks = new ISafe7579.ModuleInit[](0);

        // Hooks: just HookMultiplexer (installed as GLOBAL hook)
        // Safe7579 v1.0.0 _installHook expects: abi.encode(HookType, bytes4 selector, bytes initData)
        // HookType.GLOBAL = 0, selector = 0x0 for global hooks
        ISafe7579.ModuleInit[] memory hooks = new ISafe7579.ModuleInit[](1);
        hooks[0] = ISafe7579.ModuleInit({
            module: hookMultiplexer,
            initData: abi.encode(uint8(0), bytes4(0), bytes(""))
        });

        return abi.encodeCall(
            IAgether7579Bootstrap.initSafe7579,
            (safe7579, validators, executors, fallbacks, hooks)
        );
    }
}


