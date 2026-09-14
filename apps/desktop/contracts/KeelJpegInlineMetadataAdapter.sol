// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./KeelJpegWeb3Adapter.sol";

/// Binary KEEL storage with a conventional image data URI generated only on read.
/// The inherited .jpg endpoint still returns the original assembled JPEG bytes.
contract KeelJpegInlineMetadataAdapter is KeelJpegWeb3Adapter {
    constructor(address source_) KeelJpegWeb3Adapter(source_) {}

    function tokenJSON(uint256 id) public view override returns (string memory) {
        return _metadata(id, string.concat("data:image/jpeg;base64,", _base64(image(id))));
    }

    function _base64(bytes memory input) internal pure returns (string memory) {
        bytes memory alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 n = input.length;
        bytes memory result = new bytes(4 * ((n + 2) / 3));
        // Only the populated input bytes affect output; final padding is explicit.
        assembly ("memory-safe") {
            let table := add(alphabet, 32)
            let dst := add(result, 32)
            let src := add(input, 32)
            let end := add(src, n)
            for {} lt(src, end) { src := add(src, 3) dst := add(dst, 4) } {
                let v := shr(232, mload(src))
                switch sub(end, src)
                case 1 { v := and(v, 0xff0000) }
                case 2 { v := and(v, 0xffff00) }
                mstore8(dst, byte(0, mload(add(table, and(shr(18, v), 63)))))
                mstore8(add(dst, 1), byte(0, mload(add(table, and(shr(12, v), 63)))))
                mstore8(add(dst, 2), byte(0, mload(add(table, and(shr(6, v), 63)))))
                mstore8(add(dst, 3), byte(0, mload(add(table, and(v, 63)))))
            }
            switch mod(n, 3)
            case 1 { mstore8(sub(dst, 2), 61) mstore8(sub(dst, 1), 61) }
            case 2 { mstore8(sub(dst, 1), 61) }
        }
        return string(result);
    }
}
