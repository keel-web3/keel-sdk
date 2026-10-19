// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;
import {SyntheticAtomicExecutor} from "./SyntheticAtomicExecutor.sol";
/// Disposable browser-fixture account only. Preserves the maintained executor's
/// self-only, six-call atomic program; adds its read-only mode declaration.
contract LocalBrowserAtomicExecutor is SyntheticAtomicExecutor {
    function supportsExecutionMode(bytes32 mode) external pure returns (bool) {
        return mode == bytes32(uint256(1) << 248);
    }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xf23a6e61;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return 0xbc197c81;
    }
}
