// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./KeelSharedRasterReader.sol";

interface IJpegCollection {
    function ownerOf(uint256 id) external view returns (address);
}

/// Experimental KJC1 reader. Copies editor-prepared shared JPEG bytes; it does
/// not decode or quantize pixels. Raw JPEG delivery uses ERC-5219/7617.
contract KeelJpegCopyReader is KeelSharedRasterReader {
    IJpegCollection public immutable collection;
    uint256 public immutable pageWidth;
    uint256 public immutable idWidth;
    uint256 public immutable operationWidth;
    uint256 public immutable maxOperations;
    bytes8 public immutable codec;
    mapping(uint256 => address) public metadata;

    constructor(address hold_, address collection_, bytes8 codec_) KeelSharedRasterReader(hold_) {
        if (collection_.code.length == 0 || bytes4(codec_) != 0x4b4a4331) revert Invalid();
        uint256 pw = uint8(codec_[4]);
        uint256 iw = uint8(codec_[5]);
        uint256 ow = uint8(codec_[6]);
        uint256 mo = uint8(codec_[7]);
        if (pw == 0 || pw > 2 || iw == 0 || iw > 3 || ow != pw + 4 || mo == 0 || mo > 16) revert Invalid();
        collection = IJpegCollection(collection_);
        pageWidth = pw;
        idWidth = iw;
        operationWidth = ow;
        maxOperations = mo;
        codec = codec_;
    }

    function registerToken(uint256 id, bytes32[] calldata slugs, uint256 units, uint256 imageBytes)
        external override
    {
        if (msg.sender != owner) revert Unauthorized();
        uint256 perPage = 23000 / idWidth;
        if (units == 0 || units > 1_000_000 || slugs.length != (units + perPage - 1) / perPage
            || imageBytes == 0 || imageBytes > 16_000_000) revert Invalid();
        // Bounded allocations in this proof reader, not KEEL storage limits.
        TokenMap storage t = tokens[id];
        delete t.pages;
        t.units = units;
        t.imageBytes = imageBytes;
        for (uint256 i; i < slugs.length; i++) {
            address p = hold.slugPointer(slugs[i]);
            uint256 count = i + 1 < slugs.length ? perPage : units - i * perPage;
            if (p.code.length != count * idWidth + 1) revert Invalid();
            t.pages.push(p);
        }
    }

    function registerMetadata(uint256 id, bytes32 slug) external {
        if (msg.sender != owner) revert Unauthorized();
        address p = hold.slugPointer(slug);
        if (p.code.length < 4 || p.code.length > 23001) revert Invalid();
        metadata[id] = p;
    }

    function _image(uint256 id, uint256 start, uint256 limit)
        internal view override returns (bytes memory body, uint256 next)
    {
        if (collection.ownerOf(id) == address(0)) revert Invalid();
        TokenMap storage t = tokens[id];
        if (start >= t.units || limit == 0 || limit > 1_000_000) revert Invalid();
        uint256 end = start + limit;
        if (end > t.units) end = t.units;
        uint256[] memory instructions = new uint256[](end - start);
        uint256 count;
        uint256 iw = idWidth;
        uint256 ow = operationWidth;
        uint256 perPage = 23000 / iw;
        for (uint256 i = start; i < end; i++) {
            address p = t.pages[i / perPage];
            uint256 at = 1 + (i % perPage) * iw;
            uint256 unit;
            assembly ("memory-safe") {
                extcodecopy(p, 0, at, iw)
                unit := shr(sub(256, mul(iw, 8)), mload(0))
            }
            uint256 r = _range(3, unit);
            uint256 n = r & 65535;
            if (n % ow != 0 || n > maxOperations * ow) revert Invalid();
            instructions[i - start] = r;
            count += n / ow;
        }
        uint256[] memory copies = new uint256[](count);
        bytes memory scratch = new bytes(maxOperations * ow);
        uint256 cursor;
        uint256 length;
        for (uint256 i; i < instructions.length; i++) {
            uint256 r = instructions[i];
            uint256 n = r & 65535;
            assembly ("memory-safe") {
                extcodecopy(shr(32, r), add(scratch, 32), add(and(shr(16, r), 65535), 1), n)
            }
            for (uint256 at; at < n; at += ow) {
                uint256 op;
                assembly ("memory-safe") {
                    op := shr(sub(256, mul(ow, 8)), mload(add(add(scratch, 32), at)))
                }
                uint256 pageId = op >> 32;
                uint256 offset = (op >> 16) & 65535;
                uint256 size = op & 65535;
                address table = directories[0][pageId / 1150];
                uint256 slot = 1 + (pageId % 1150) * 20;
                address p;
                if (table == address(0) || slot + 20 > table.code.length) revert Invalid();
                assembly ("memory-safe") {
                    extcodecopy(table, 0, slot, 20)
                    p := shr(96, mload(0))
                }
                if (size == 0 || offset + size + 1 > p.code.length) revert Invalid();
                copies[cursor++] = (uint256(uint160(p)) << 32) | (offset << 16) | size;
                length += size;
            }
        }
        if (length > t.imageBytes) revert Invalid();
        body = new bytes(length);
        cursor = 0;
        for (uint256 i; i < copies.length; i++) {
            uint256 r = copies[i];
            uint256 n = r & 65535;
            assembly ("memory-safe") {
                extcodecopy(shr(32, r), add(add(body, 32), cursor), add(and(shr(16, r), 65535), 1), n)
            }
            cursor += n;
        }
        if (start == 0 && end == t.units && length != t.imageBytes) revert Invalid();
        next = end < t.units ? end : 0;
    }

    function tokenJSON(uint256 id) public view returns (string memory) {
        if (collection.ownerOf(id) == address(0) || tokens[id].units == 0) revert Invalid();
        address p = metadata[id];
        if (p == address(0)) revert Invalid();
        bytes memory b = new bytes(p.code.length - 1);
        assembly ("memory-safe") { extcodecopy(p, add(b, 32), 1, mload(b)) }
        uint256 prefixLength = (uint256(uint8(b[0])) << 8) | uint8(b[1]);
        if (prefixLength + 2 > b.length) revert Invalid();
        bytes memory prefix = new bytes(prefixLength);
        bytes memory suffix = new bytes(b.length - prefixLength - 2);
        assembly ("memory-safe") {
            mcopy(add(prefix, 32), add(b, 34), prefixLength)
            mcopy(add(suffix, 32), add(add(b, 34), prefixLength), mload(suffix))
        }
        return string.concat(string(prefix), "web3://", _address(address(this)), ":", _text(block.chainid),
            "/image/", _text(id), string(suffix));
    }

    function request(string[] memory path, KeyValue[] memory)
        external view override returns (uint16, string memory, KeyValue[] memory headers)
    {
        if (path.length < 2 || path.length > 3) revert Invalid();
        uint256 id = _number(path[1]);
        if (keccak256(bytes(path[0])) == keccak256("tokenJSON") && path.length == 2) {
            headers = new KeyValue[](1);
            headers[0] = KeyValue("Content-Type", "application/json");
            return (200, tokenJSON(id), headers);
        }
        if (keccak256(bytes(path[0])) != keccak256("image")) revert Invalid();
        uint256 start = path.length == 3 ? _number(path[2]) : 0;
        (bytes memory body, uint256 next) = _image(id, start, 32);
        headers = new KeyValue[](next == 0 ? 1 : 2);
        headers[0] = KeyValue("Content-Type", "image/jpeg");
        if (next != 0) headers[1] = KeyValue("web3-next-chunk", string.concat("/image/", _text(id), "/", _text(next)));
        return (200, string(body), headers);
    }

    function _address(address a) private pure returns (string memory) {
        bytes memory b = new bytes(42);
        b[0] = "0"; b[1] = "x";
        bytes memory h = "0123456789abcdef";
        for (uint256 i; i < 20; i++) {
            uint8 v = uint8(uint160(a) >> (8 * (19 - i)));
            b[2 + i * 2] = h[v >> 4]; b[3 + i * 2] = h[v & 15];
        }
        return string(b);
    }
}
