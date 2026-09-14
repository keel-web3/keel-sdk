// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRegionHold {
    function slugPointer(bytes32 id) external view returns (address);
}

/// Experimental read-cost fixture: frozen uint32 assembly maps and packed KEEL fragments.
/// Authoring resolves layering and PNG checksums; this contract only reads the prepared bytes.
/// Carrier sizing and fixture allocation guards below are not KEEL project-size limits.
contract KeelRasterRegionReader {
    IRegionHold public immutable hold;
    address public immutable owner;
    mapping(uint256 => address) public catalogPages;

    struct TokenMap {
        uint256 count;
        uint256 imageBytes;
        address[] pages;
    }

    struct KeyValue {
        string key;
        string value;
    }
    mapping(uint256 => TokenMap) private maps;
    error Invalid();
    error Unauthorized();

    constructor(address hold_) {
        if (hold_.code.length == 0) revert Invalid();
        hold = IRegionHold(hold_);
        owner = msg.sender;
    }

    function registerCatalog(uint256[] calldata indexes, bytes32[] calldata slugs) external {
        if (msg.sender != owner) revert Unauthorized();
        if (indexes.length != slugs.length || slugs.length == 0 || slugs.length > 100) revert Invalid();
        for (uint256 i; i < slugs.length; i++) {
            address p = hold.slugPointer(slugs[i]);
            if (p.code.length <= 1 || p.code.length > 23001 || (p.code.length - 1) % 24 != 0) revert Invalid();
            catalogPages[indexes[i]] = p;
        }
    }

    function registerToken(uint256 id, bytes32[] calldata slugs, uint256 count, uint256 imageBytes) external {
        if (msg.sender != owner) revert Unauthorized();
        if (
            count == 0 || count > 1_000_000 || slugs.length != (count + 5749) / 5750 || imageBytes == 0
                || imageBytes > 16_000_000
        ) {
            revert Invalid();
        }
        TokenMap storage t = maps[id];
        delete t.pages;
        t.count = count;
        t.imageBytes = imageBytes;
        for (uint256 i; i < slugs.length; i++) {
            address p = hold.slugPointer(slugs[i]);
            uint256 expected = i + 1 < slugs.length ? 23000 : (count - i * 5750) * 4;
            if (p.code.length != expected + 1) revert Invalid();
            t.pages.push(p);
        }
    }

    function image(uint256 id, uint256 start, uint256 limit) public view returns (bytes memory body, uint256 next) {
        TokenMap storage t = maps[id];
        if (start >= t.count || limit == 0 || limit > 1_000_000) revert Invalid();
        uint256 end = start + limit;
        if (end > t.count) end = t.count;
        // Resolve and validate each fragment once. Keeping compact descriptors in
        // memory avoids repeating map/catalog/storage reads during the copy pass.
        uint256[] memory records = new uint256[](end - start);
        uint256 length;
        for (uint256 i = start; i < end; i++) {
            (address p, uint256 offset, uint256 n) = _record(t, i);
            records[i - start] = (uint256(uint160(p)) << 32) | (offset << 16) | n;
            length += n;
        }
        if (length > t.imageBytes || length > 16_000_000) revert Invalid();
        body = new bytes(length);
        uint256 cursor;
        for (uint256 i; i < records.length; i++) {
            uint256 record = records[i];
            uint256 n = record & 65535;
            assembly ("memory-safe") {
                extcodecopy(shr(32, record), add(add(body, 32), cursor), add(and(shr(16, record), 65535), 1), n)
            }
            cursor += n;
        }
        if (start == 0 && end == t.count && length != t.imageBytes) revert Invalid();
        next = end < t.count ? end : 0;
    }

    function _record(TokenMap storage t, uint256 index)
        private
        view
        returns (address pointer, uint256 offset, uint256 length)
    {
        address mapPage = t.pages[index / 5750];
        uint256 mapOffset = 1 + (index % 5750) * 4;
        uint256 id;
        assembly ("memory-safe") {
            extcodecopy(mapPage, 0, mapOffset, 4)
            id := shr(224, mload(0))
        }
        address page = catalogPages[id / 958];
        uint256 recordOffset = 1 + (id % 958) * 24;
        if (page == address(0) || recordOffset + 24 > page.code.length) revert Invalid();
        assembly ("memory-safe") {
            extcodecopy(page, 0, recordOffset, 24)
            let word := mload(0)
            pointer := shr(96, word)
            offset := and(shr(80, word), 65535)
            length := and(shr(64, word), 65535)
        }
        if (length == 0 || offset + length + 1 > pointer.code.length) revert Invalid();
    }

    function resolveMode() external pure returns (bytes32) {
        return "5219";
    }

    function request(string[] memory path, KeyValue[] memory)
        external
        view
        returns (uint16, string memory, KeyValue[] memory headers)
    {
        if (path.length < 2 || path.length > 3 || keccak256(bytes(path[0])) != keccak256("image")) revert Invalid();
        uint256 id = _number(path[1]);
        uint256 start = path.length == 3 ? _number(path[2]) : 0;
        (bytes memory body, uint256 next) = image(id, start, 512);
        headers = new KeyValue[](next == 0 ? 1 : 2);
        headers[0] = KeyValue("Content-Type", "image/png");
        if (next != 0) headers[1] = KeyValue("web3-next-chunk", string.concat("/image/", _text(id), "/", _text(next)));
        return (200, string(body), headers);
    }

    function _number(string memory s) private pure returns (uint256 n) {
        bytes memory b = bytes(s);
        if (b.length == 0 || b.length > 10) revert Invalid();
        for (uint256 i; i < b.length; i++) {
            if (b[i] < "0" || b[i] > "9") revert Invalid();
            n = n * 10 + uint8(b[i]) - 48;
        }
    }

    function _text(uint256 n) private pure returns (string memory) {
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
