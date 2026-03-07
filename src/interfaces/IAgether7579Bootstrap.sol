// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ISafe7579.sol";

/**
 * @dev Minimal interface for bootstrap — needed for abi.encodeCall
 */
interface IAgether7579Bootstrap {
    function initSafe7579(
        address safe7579,
        ISafe7579.ModuleInit[] calldata validators,
        ISafe7579.ModuleInit[] calldata executors,
        ISafe7579.ModuleInit[] calldata fallbacks,
        ISafe7579.ModuleInit[] calldata hooks
    ) external;
}