// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;
import "StateSequence.sol";

// Synthetic only; never sent to an external RPC or deployed.
contract ForkSequence is StateSequence {
    function tokenURIFor(uint256 expectedCursor) external view returns (string memory) {
        uint256 cursor;
        assembly { cursor := sload(0) }
        require(cursor == expectedCursor, "incomplete sequence");
        return 'data:application/json,{"name":"Synthetic bounded sequence"}';
    }

    function clear(uint256 count) external {
        for (uint256 i; i < count; i++) {
            assembly { sstore(add(i, 1), 0) }
        }
    }

    function gasSensitive(uint256 threshold) external returns (uint256) {
        uint256 branch = gasleft() > threshold ? 1 : 2;
        assembly { sstore(0, branch) }
        return branch;
    }
}
