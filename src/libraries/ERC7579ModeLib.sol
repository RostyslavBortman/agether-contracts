// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ERC7579ModeLib
 * @notice Library for encoding/decoding ERC-7579 execution modes
 * @dev ModeCode layout (bytes32):
 *      ┌──────────┬──────────┬──────────┬──────────────┬──────────────┐
 *      │ callType │ execType │ unused   │ modeSelector │ modePayload  │
 *      │ 1 byte   │ 1 byte   │ 4 bytes  │ 4 bytes      │ 22 bytes     │
 *      └──────────┴──────────┴──────────┴──────────────┴──────────────┘
 */
library ERC7579ModeLib {
    // ═══════════════════════════════════════════════════════════════════════
    //                          CALL TYPES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Single call: execute(target, value, callData)
    bytes1 internal constant CALLTYPE_SINGLE = 0x00;

    /// @notice Batch call: execute([{target, value, callData}, ...])
    bytes1 internal constant CALLTYPE_BATCH = 0x01;

    /// @notice Delegatecall (optional, not supported by default)
    bytes1 internal constant CALLTYPE_DELEGATECALL = 0xff;

    // ═══════════════════════════════════════════════════════════════════════
    //                          EXEC TYPES
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Default: revert on failure
    bytes1 internal constant EXECTYPE_DEFAULT = 0x00;

    /// @notice Try: continue on failure (return success/failure per call)
    bytes1 internal constant EXECTYPE_TRY = 0x01;

    // ═══════════════════════════════════════════════════════════════════════
    //                        MODULE TYPE IDs
    // ═══════════════════════════════════════════════════════════════════════

    uint256 internal constant TYPE_VALIDATOR = 1;
    uint256 internal constant TYPE_EXECUTOR = 2;
    uint256 internal constant TYPE_FALLBACK = 3;
    uint256 internal constant TYPE_HOOK = 4;

    // ═══════════════════════════════════════════════════════════════════════
    //                          DECODING
    // ═══════════════════════════════════════════════════════════════════════

    function decodeMode(bytes32 mode)
        internal
        pure
        returns (bytes1 callType, bytes1 execType, bytes4 modeSelector, bytes22 modePayload)
    {
        callType = bytes1(mode);
        execType = bytes1(mode << 8);
        modeSelector = bytes4(mode << 48);
        modePayload = bytes22(mode << 80);
    }

    function getCallType(bytes32 mode) internal pure returns (bytes1) {
        return bytes1(mode);
    }

    function getExecType(bytes32 mode) internal pure returns (bytes1) {
        return bytes1(mode << 8);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          ENCODING
    // ═══════════════════════════════════════════════════════════════════════

    function encodeMode(
        bytes1 callType,
        bytes1 execType,
        bytes4 modeSelector,
        bytes22 modePayload
    ) internal pure returns (bytes32) {
        return bytes32(abi.encodePacked(callType, execType, bytes4(0), modeSelector, modePayload));
    }

    /// @notice Encode a simple single-call default-revert mode
    function encodeSingle() internal pure returns (bytes32) {
        return encodeMode(CALLTYPE_SINGLE, EXECTYPE_DEFAULT, bytes4(0), bytes22(0));
    }

    /// @notice Encode a simple batch-call default-revert mode
    function encodeBatch() internal pure returns (bytes32) {
        return encodeMode(CALLTYPE_BATCH, EXECTYPE_DEFAULT, bytes4(0), bytes22(0));
    }

    /// @notice Encode a single-call try mode
    function encodeSingleTry() internal pure returns (bytes32) {
        return encodeMode(CALLTYPE_SINGLE, EXECTYPE_TRY, bytes4(0), bytes22(0));
    }

    /// @notice Encode a batch-call try mode
    function encodeBatchTry() internal pure returns (bytes32) {
        return encodeMode(CALLTYPE_BATCH, EXECTYPE_TRY, bytes4(0), bytes22(0));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    EXECUTION DATA ENCODING
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Encode single execution data
    function encodeSingleExecution(address target, uint256 value, bytes memory callData)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(target, value, callData);
    }

    /// @notice Decode single execution data
    function decodeSingleExecution(bytes calldata executionCalldata)
        internal
        pure
        returns (address target, uint256 value, bytes calldata callData)
    {
        target = address(bytes20(executionCalldata[:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }

    /// @notice Decode batch execution data
    /// @dev Batch format: abi.encode(Execution[]) where Execution = (address target, uint256 value, bytes callData)
    function decodeBatchExecution(bytes calldata executionCalldata)
        internal
        pure
        returns (Execution[] calldata executions)
    {
        assembly {
            let dataPointer := add(executionCalldata.offset, calldataload(executionCalldata.offset))
            executions.offset := add(dataPointer, 32)
            executions.length := calldataload(dataPointer)
        }
    }
}

/// @notice Execution struct for batch operations
struct Execution {
    address target;
    uint256 value;
    bytes callData;
}
