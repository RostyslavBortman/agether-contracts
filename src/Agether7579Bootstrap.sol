// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ISafe.sol";
import "./interfaces/ISafe7579.sol";
import "./interfaces/IAgether7579Bootstrap.sol";

/**
 * @title Agether7579Bootstrap
 * @notice Initialization helper for Safe + Safe7579 setup
 * @dev This contract is delegatecalled by Safe.setup() (inside setupModules)
 *      to wire up Safe7579 and install ERC-7579 modules in a single atomic tx.
 *
 *      Flow:
 *      1. Agether4337Factory calls SafeProxyFactory.createProxyWithNonce()
 *      2. SafeProxyFactory deploys Safe proxy and calls Safe.setup()
 *      3. Safe.setup() sets fallback handler to Safe7579, then calls setupModules
 *      4. setupModules initializes the modules linked list, then delegatecalls bootstrap
 *      5. Bootstrap (running as Safe) enables Safe7579 as a module
 *      6. Bootstrap calls initializeAccount on address(this) — the Safe proxy
 *         The Safe singleton doesn't have this function, so it routes through
 *         FallbackManager → Safe7579 with correct ERC-2771 sender context
 *
 *      NOTE: This contract is stateless — it only contains setup logic.
 */
contract Agether7579Bootstrap is IAgether7579Bootstrap {

    /**
     * @notice Initialize Safe7579 with modules
     * @dev Called via delegatecall from Safe.setup(). Executes in Safe's context.
     *
     * @param safe7579    The Safe7579 adapter singleton address
     * @param validators  Validator modules (type 1)
     * @param executors   Executor modules  (type 2)
     * @param fallbacks   Fallback modules  (type 3)
     * @param hooks       Hook modules      (type 4)
     */
    function initSafe7579(
        address safe7579,
        ISafe7579.ModuleInit[] calldata validators,
        ISafe7579.ModuleInit[] calldata executors,
        ISafe7579.ModuleInit[] calldata fallbacks,
        ISafe7579.ModuleInit[] calldata hooks
    ) external {
        // We're running as the Safe via delegatecall.
        // address(this) == Safe proxy address.

        // 1. Enable Safe7579 as a Safe module
        // Self-call: msg.sender for enableModule will be address(this) = Safe
        ISafe(address(this)).enableModule(safe7579);

        // 2. Initialize Safe7579 by calling initializeAccount on address(this).
        //    The Safe singleton doesn't have this function, so the call routes
        //    through the Safe's FallbackManager to the fallback handler (= Safe7579).
        //    FallbackManager appends msg.sender (= Safe proxy) to calldata.
        //    Safe7579's onlyEntryPointOrSelf checks _msgSender() == msg.sender,
        //    which passes because both are the Safe proxy address.
        ISafe7579(payable(address(this))).initializeAccount(
            validators,
            executors,
            fallbacks,
            hooks,
            ISafe7579.RegistryInit({
                registry: address(0),
                attesters: new address[](0),
                threshold: 0
            })
        );
    }
}
