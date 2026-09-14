// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./KeelSharedRasterReader.sol";

/// Local proof: instructions carry direct page ranges and repeat counts.
/// Repeated contiguous bytes do not need repeated fragment catalog lookups.
contract KeelRasterCopyReader is KeelSharedRasterReader {
    constructor(address hold_) KeelSharedRasterReader(hold_) {}

    // Amortize repeated directory reads across more instructions per RPC response.
    function _requestUnits() internal pure override returns (uint256) { return 128; }

    function _image(uint256 id, uint256 start, uint256 limit)
        internal
        view
        override
        returns (bytes memory body, uint256 next)
    {
        TokenMap storage t = tokens[id];
        if (start >= t.units || limit == 0 || limit > 1_000_000) revert Invalid();
        uint256 end = start + limit;
        if (end > t.units) end = t.units;
        uint256[] memory instructions = new uint256[](end - start);
        uint256 count;
        for (uint256 i = start; i < end; i++) {
            address mapPage = t.pages[i / 7666];
            uint256 at = 1 + (i % 7666) * 3;
            uint256 unit;
            assembly ("memory-safe") {
                extcodecopy(mapPage, 0, at, 3)
                unit := shr(232, mload(0))
            }
            uint256 record = _range(3, unit);
            uint256 n = record & 65535;
            if (n < 6 || n % 2 != 0 || n > 32) revert Invalid();
            instructions[i - start] = record;
            count += 4;
        }
        uint256[] memory copies = new uint256[](count);
        bytes memory scratch = new bytes(32);
        uint256 cursor;
        uint256 length;
        for (uint256 i; i < instructions.length; i++) {
            uint256 record = instructions[i];
            uint256 n = record & 65535;
            assembly ("memory-safe") {
                extcodecopy(shr(32, record), add(scratch, 32), add(and(shr(16, record), 65535), 1), n)
            }
            uint256 operations;
            for (uint256 at; at < n;) {
                if (++operations > 4 || at + 6 > n) revert Invalid();
                uint256 op;
                assembly ("memory-safe") { op := shr(192, mload(add(add(scratch, 32), at))) }
                uint256 pageId = op >> 48;
                uint256 offset = (op >> 32) & 65535;
                uint256 tagged = (op >> 16) & 65535;
                bool hasRepeat = (tagged & 32768) != 0;
                if (hasRepeat && at + 8 > n) revert Invalid();
                uint256 size = tagged & 32767;
                uint256 repeat = hasRepeat ? op & 65535 : 1;
                at += hasRepeat ? 8 : 6;
                address addresses = directories[0][pageId / 1150];
                uint256 slot = 1 + (pageId % 1150) * 20;
                address p;
                if (addresses == address(0) || slot + 20 > addresses.code.length) revert Invalid();
                assembly ("memory-safe") {
                    extcodecopy(addresses, 0, slot, 20)
                    p := shr(96, mload(0))
                }
                if (size == 0 || repeat == 0 || offset + size + 1 > p.code.length) revert Invalid();
                copies[cursor++] = (uint256(uint160(p)) << 48) | (offset << 32) | (size << 16) | repeat;
                length += size * repeat;
            }
        }
        if (length > t.imageBytes || length > 16_000_000) revert Invalid();
        count = cursor;
        body = new bytes(length);
        cursor = 0;
        for (uint256 i; i < count; i++) {
            uint256 op = copies[i];
            uint256 size = (op >> 16) & 65535;
            uint256 repeat = op & 65535;
            for (uint256 j; j < repeat; j++) {
                assembly ("memory-safe") {
                    extcodecopy(shr(48, op), add(add(body, 32), cursor), add(and(shr(32, op), 65535), 1), size)
                }
                cursor += size;
            }
        }
        if (start == 0 && end == t.units && length != t.imageBytes) revert Invalid();
        next = end < t.units ? end : 0;
    }
}
