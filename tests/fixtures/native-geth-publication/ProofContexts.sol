// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

// Synthetic genesis fixture. Never deployed or sent to a public RPC.
contract ProofChild {
    uint256 public marker = 42;
    function dispose() external { selfdestruct(payable(msg.sender)); }
}

contract ProofContexts {
    ProofChild public child;

    function context() external view returns (
        uint256, uint256, uint256, uint256, uint256, address, address, address, uint256, bytes32
    ) {
        return (block.number, block.timestamp, block.chainid, block.basefee,
            block.prevrandao, block.coinbase, msg.sender, tx.origin,
            address(this).balance, blockhash(block.number - 1));
    }

    function create() external returns (address) {
        child = new ProofChild();
        return address(child);
    }

    function observeChild() external view returns (uint256) { return child.marker(); }

    function createAndDestroy() external returns (address) {
        ProofChild ephemeral = new ProofChild();
        ephemeral.dispose();
        return address(ephemeral);
    }

    function accept(bytes calldata value) external pure returns (bytes32) { return keccak256(value); }

    function clear(bool readSibling) external returns (uint256 sibling) {
        // The genesis fixture has exactly these two nonzero storage slots.
        // A deletion may need the surviving sibling node to compute its real root.
        assembly {
            if readSibling { sibling := sload(10001) }
            sstore(10000, 0)
        }
    }
}
