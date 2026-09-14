// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IKeelJpegSource {
    function image(uint256 id, uint256 start, uint256 limit) external view returns (bytes memory, uint256);
    function tokenJSON(uint256 id) external view returns (string memory);
    function metadata(uint256 id) external view returns (address);
}

/// ERC-6860 manual-mode compatibility for an existing shared JPEG reader.
/// No artwork storage, admin keys, or changes to the source reader.
contract KeelJpegWeb3Adapter {
    error Invalid();
    IKeelJpegSource public immutable source;

    constructor(address source_) {
        if (source_.code.length == 0) revert Invalid();
        source = IKeelJpegSource(source_);
    }

    function resolveMode() external pure returns (bytes32) { return "manual"; }

    function image(uint256 id) public view returns (bytes memory body) {
        uint256 next;
        (body, next) = source.image(id, 0, 1_000_000);
        if (next != 0) revert Invalid();
    }

    function tokenJSON(uint256 id) public view virtual returns (string memory) {
        return _metadata(id, string.concat("web3://", _address(address(this)), ":", _text(block.chainid),
            "/image/", _text(id), ".jpg"));
    }

    function _metadata(uint256 id, string memory imageURI) internal view returns (string memory) {
        // Preserve the source reader's minted-token and registration checks.
        source.tokenJSON(id);
        address p = source.metadata(id);
        if (p.code.length < 4) revert Invalid();
        bytes memory envelope = new bytes(p.code.length - 1);
        assembly ("memory-safe") { extcodecopy(p, add(envelope, 32), 1, mload(envelope)) }
        uint256 n = (uint256(uint8(envelope[0])) << 8) | uint8(envelope[1]);
        if (n + 2 > envelope.length) revert Invalid();
        bytes memory prefix = new bytes(n);
        bytes memory suffix = new bytes(envelope.length - n - 2);
        assembly ("memory-safe") {
            mcopy(add(prefix, 32), add(envelope, 34), n)
            mcopy(add(suffix, 32), add(add(envelope, 34), n), mload(suffix))
        }
        return string.concat(string(prefix), imageURI, string(suffix));
    }

    fallback(bytes calldata path) external returns (bytes memory) {
        // Manual web3 mode sends the path as calldata and expects ABI-encoded bytes.
        bool json;
        uint256 first;
        uint256 end;
        if (path.length >= 17 && keccak256(path[:11]) == keccak256("/tokenJSON/")
            && keccak256(path[path.length-5:]) == keccak256(".json")) {
            json = true; first = 11; end = path.length - 5;
        } else if (path.length >= 12 && keccak256(path[:7]) == keccak256("/image/")
            && keccak256(path[path.length-4:]) == keccak256(".jpg")) {
            first = 7; end = path.length - 4;
        } else revert Invalid();
        if (end <= first || end - first > 10 || (end-first > 1 && path[first] == "0")) revert Invalid();
        uint256 id;
        for (uint256 i = first; i < end; i++) {
            uint8 c = uint8(path[i]);
            if (c < 48 || c > 57) revert Invalid();
            id = id * 10 + c - 48;
        }
        return abi.encode(json ? bytes(tokenJSON(id)) : image(id));
    }

    function _text(uint256 n) private pure returns (string memory) {
        if (n == 0) return "0";
        uint256 x=n; uint256 length;
        while (x!=0) { length++; x/=10; }
        bytes memory b=new bytes(length);
        while (n!=0) { b[--length]=bytes1(uint8(48+n%10)); n/=10; }
        return string(b);
    }

    function _address(address a) private pure returns (string memory) {
        bytes memory b=new bytes(42); b[0]="0"; b[1]="x";
        bytes memory h="0123456789abcdef";
        for (uint256 i; i<20; i++) {
            uint8 v=uint8(uint160(a)>>(8*(19-i))); b[2+i*2]=h[v>>4]; b[3+i*2]=h[v&15];
        }
        return string(b);
    }
}
