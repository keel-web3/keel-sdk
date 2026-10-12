// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

// Synthetic EIP-7702 fixture only. No deployment or wallet action.
contract SyntheticAtomicExecutor {
    struct Call { address target; uint256 value; bytes callData; }
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable {
        require(msg.sender == address(this), "self only");
        require(mode == bytes32(uint256(1) << 248), "atomic batch mode");
        Call[] memory calls = abi.decode(executionCalldata, (Call[]));
        require(calls.length == 6, "six original calls");
        for (uint256 i; i < calls.length; ++i) {
            (bool success, bytes memory result) = calls[i].target.call{value: calls[i].value}(calls[i].callData);
            if (!success) assembly { revert(add(result, 32), mload(result)) }
        }
    }
}
