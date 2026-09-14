// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISharedRasterHold {
    function slugPointer(bytes32 slug) external view returns (address);
}

/// Local proof fixture for shared row instructions and compact page catalogs.
/// Prepared PNG bytes can span any number of carriers. Fixture allocation guards
/// are not project or KEEL storage-size limits.
contract KeelSharedRasterReader {
    ISharedRasterHold public immutable hold;
    address public immutable owner;
    // 0: data page addresses; 1: data ranges; 2: instruction page addresses; 3: instruction ranges.
    mapping(uint8 => mapping(uint256 => address)) public directories;

    struct TokenMap {
        uint256 units;
        uint256 imageBytes;
        address[] pages;
    }

    struct KeyValue {
        string key;
        string value;
    }
    mapping(uint256 => TokenMap) internal tokens;
    error Invalid();
    error Unauthorized();

    constructor(address hold_) {
        if (hold_.code.length == 0) revert Invalid();
        hold = ISharedRasterHold(hold_);
        owner = msg.sender;
    }

    function registerDirectory(uint8 kind, uint256[] calldata indexes, bytes32[] calldata slugs) external {
        if (msg.sender != owner) revert Unauthorized();
        if (kind > 3 || indexes.length != slugs.length || slugs.length == 0 || slugs.length > 100) revert Invalid();
        uint256 stride = kind % 2 == 0 ? 20 : 6;
        for (uint256 i; i < slugs.length; i++) {
            address p = hold.slugPointer(slugs[i]);
            if (p.code.length <= 1 || p.code.length > 23001 || (p.code.length - 1) % stride != 0) revert Invalid();
            directories[kind][indexes[i]] = p;
        }
    }

    function registerToken(uint256 id, bytes32[] calldata slugs, uint256 units, uint256 imageBytes) external virtual {
        if (msg.sender != owner) revert Unauthorized();
        if (
            units == 0 || units > 1_000_000 || slugs.length != (units + 7665) / 7666 || imageBytes == 0
                || imageBytes > 16_000_000
        ) revert Invalid();
        TokenMap storage t = tokens[id];
        delete t.pages;
        t.units = units;
        t.imageBytes = imageBytes;
        for (uint256 i; i < slugs.length; i++) {
            address p = hold.slugPointer(slugs[i]);
            uint256 n = i + 1 < slugs.length ? 22998 : (units - i * 7666) * 3;
            if (p.code.length != n + 1) revert Invalid();
            t.pages.push(p);
        }
    }

    function _range(uint8 kind, uint256 id) internal view returns (uint256 record) {
        address table = directories[kind][id / 3833];
        uint256 at = 1 + (id % 3833) * 6;
        uint256 packed;
        if (table == address(0) || at + 6 > table.code.length) revert Invalid();
        assembly ("memory-safe") {
            extcodecopy(table, 0, at, 6)
            packed := shr(208, mload(0))
        }
        uint256 pageId = packed >> 32;
        address addresses = directories[kind - 1][pageId / 1150];
        at = 1 + (pageId % 1150) * 20;
        address p;
        if (addresses == address(0) || at + 20 > addresses.code.length) revert Invalid();
        assembly ("memory-safe") {
            extcodecopy(addresses, 0, at, 20)
            p := shr(96, mload(0))
        }
        uint256 offset = (packed >> 16) & 65535;
        uint256 n = packed & 65535;
        if (n == 0 || offset + n + 1 > p.code.length) revert Invalid();
        record = (uint256(uint160(p)) << 32) | (offset << 16) | n;
    }

    function _image(uint256 id, uint256 start, uint256 limit)
        internal
        view
        virtual
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
            if (n % 3 != 0 || n > 96) revert Invalid(); // This codec version stores up to 32 references per instruction.
            instructions[i - start] = record;
            count += n / 3;
        }
        uint256[] memory fragments = new uint256[](count);
        bytes memory scratch = new bytes(96);
        uint256 cursor;
        uint256 length;
        for (uint256 i; i < instructions.length; i++) {
            uint256 record = instructions[i];
            uint256 n = record & 65535;
            assembly ("memory-safe") {
                extcodecopy(shr(32, record), add(scratch, 32), add(and(shr(16, record), 65535), 1), n)
            }
            for (uint256 at; at < n; at += 3) {
                uint256 fragment;
                assembly ("memory-safe") { fragment := shr(232, mload(add(add(scratch, 32), at))) }
                uint256 resolved = _range(1, fragment);
                fragments[cursor++] = resolved;
                length += resolved & 65535;
            }
        }
        if (length > t.imageBytes || length > 16_000_000) revert Invalid();
        body = new bytes(length);
        cursor = 0;
        for (uint256 i; i < fragments.length; i++) {
            uint256 record = fragments[i];
            uint256 n = record & 65535;
            assembly ("memory-safe") {
                extcodecopy(shr(32, record), add(add(body, 32), cursor), add(and(shr(16, record), 65535), 1), n)
            }
            cursor += n;
        }
        if (start == 0 && end == t.units && length != t.imageBytes) revert Invalid();
        next = end < t.units ? end : 0;
    }

    function image(uint256 id, uint256 start, uint256 limit) external view returns (bytes memory, uint256) {
        (bytes memory body, uint256 next) = _image(id, start, limit);
        // Reuse memory whose descriptor pass is finished, avoiding a second full
        // image allocation solely to ABI-encode this external response.
        assembly ("memory-safe") {
            let out := sub(body, 64)
            mstore(out, 64)
            mstore(add(out, 32), next)
            mstore(add(add(body, 32), mload(body)), 0)
            return(out, add(96, and(add(mload(body), 31), not(31))))
        }
    }

    function _requestUnits() internal pure virtual returns (uint256) { return 32; }

    function resolveMode() external pure returns (bytes32) {
        return "5219";
    }

    function request(string[] memory path, KeyValue[] memory)
        external
        view
        virtual
        returns (uint16, string memory, KeyValue[] memory headers)
    {
        if (path.length < 2 || path.length > 3 || keccak256(bytes(path[0])) != keccak256("image")) {
            revert Invalid();
        }
        uint256 id = _number(path[1]);
        uint256 start = path.length == 3 ? _number(path[2]) : 0;
        (bytes memory body, uint256 next) = _image(id, start, _requestUnits());
        headers = new KeyValue[](next == 0 ? 1 : 2);
        headers[0] = KeyValue("Content-Type", "image/png");
        if (next != 0) headers[1] = KeyValue("web3-next-chunk", string.concat("/image/", _text(id), "/", _text(next)));
        return (200, string(body), headers);
    }

    function _number(string memory s) internal pure returns (uint256 n) {
        bytes memory b = bytes(s);
        if (b.length == 0 || b.length > 10) revert Invalid();
        for (uint256 i; i < b.length; i++) {
            if (b[i] < "0" || b[i] > "9") revert Invalid();
            n = n * 10 + uint8(b[i]) - 48;
        }
    }

    function _text(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "0";
        uint256 x = n;
        uint256 length;
        while (x != 0) {
            length++;
            x /= 10;
        }
        bytes memory b = new bytes(length);
        while (n != 0) {
            b[--length] = bytes1(uint8(48 + n % 10));
            n /= 10;
        }
        return string(b);
    }
}
