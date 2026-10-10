// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

// Synthetic fixture only. Never deployed, signed, or sent to a public RPC.
contract StateSequence {
    function write(uint256 count) external returns (uint256 next) {
        uint256 cursor;
        assembly { cursor := sload(0) }
        for (uint256 i; i < count; i++) {
            assembly { sstore(add(add(cursor, i), 1), 1) }
        }
        next = cursor + count;
        assembly { sstore(0, next) }
    }

    function read() external view returns (uint256 cursor) {
        assembly { cursor := sload(0) }
    }

    function tokenURI(uint256) external view returns (string memory) {
        uint256 cursor;
        assembly { cursor := sload(0) }
        require(cursor == 500, "incomplete sequence");
        return 'data:application/json,{"name":"Synthetic state sequence"}';
    }
}
