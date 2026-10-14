// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IKeelHold} from "@keel/keel-hold/interfaces/IKeelHold.sol";
import {KeelSealValidation} from "@keel/keel-hold/libraries/KeelSealValidation.sol";
import {IKeelRawTokenURIBuilder} from "@keel/keel-harness/interfaces/IKeelRawTokenURIBuilder.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {KeelUriEscape} from "@keel/keel-kernel/libraries/KeelUriEscape.sol";

/// @notice Optional legacy KEEL721 reader for one native image shared by metadata
/// and artwork. Other source fragments remain prepared COPY. This reader never
/// stores an encoded image, encodes an artwork pack, or changes collection authority.
/// @dev Requires its own deployed runtime, Hold harness registration and reviewed
/// source program. It cannot be substituted for the old raw-percent builder.
contract KeelLegacySharedImageTokenURIBuilder {
    // forgefmt: disable-start
    struct Program {
        bytes32   profile       ;
        uint256   renderedBytes ;
        bytes32   renderedDigest;
        bytes32   imageObjectId ;
        bytes32   imageDigest   ;
        uint256   imageBytes    ;
        bytes32[] objectIds     ;
        bytes32[] digests       ;
        uint8[]   modes         ;
    }

    bytes32 public constant PROGRAM_PROFILE = keccak256("keel.legacy-shared-image-copy-program@1");
    bytes32 private constant PROGRAM_MEDIA = keccak256("application/vnd.keel.legacy-shared-image-copy-program");
    bytes32 private constant COPY_MEDIA = keccak256("application/vnd.keel.token-uri-raw-percent-fragment");
    uint256 public constant MAX_RENDERED_BYTES = 2_000_000;
    IKeelHold public immutable keelHold;
    IKeelRawTokenURIBuilder public immutable contextBuilder;
    // forgefmt: disable-end

    error InvalidStore();
    error InvalidProgram();
    error InvalidBinding();
    error InvalidEnvelope();

    constructor(address store, address contextBuilder_) {
        if (store.code.length == 0 || contextBuilder_.code.length == 0) revert InvalidStore();
        keelHold = IKeelHold(store);
        contextBuilder = IKeelRawTokenURIBuilder(contextBuilder_);
    }

    function requireRegistration(bytes32 objectId) external view returns (bool) {
        KeelSealValidation.requireHoldHarness(address(keelHold), address(this), objectId);
        return true;
    }

    function rawTokenURI() external pure returns (bool) { return true; }
    function percentEscape(bytes memory value) external pure returns (bytes memory) { return KeelUriEscape.escape(value); }
    function contextURI(bytes memory contextJSON) public view returns (bytes memory) { return contextBuilder.contextURI(contextJSON); }

    /// @dev A literal-image prepared envelope would duplicate the native payload
    /// in collection storage. Only the existing dynamic image-module route applies.
    function preparedTokenURIEnvelopeValid(bytes32, bytes32, bytes calldata, bytes calldata) external pure returns (bool) { return false; }
    function preparedTokenURI(bytes32, bytes32, bytes calldata, bytes calldata) external pure returns (string memory) { revert InvalidEnvelope(); }

    function preEncodedTokenURIFragmentValid(bytes32 objectId, bytes32 digest) external view returns (bool) {
        _render(_program(objectId, digest));
        return true;
    }

    function preEncodedTokenURI(bytes32 objectId, bytes32 digest, bytes calldata rawPrefix, bytes calldata rawSuffix)
        external view returns (string memory)
    {
        Program memory p = _program(objectId, digest);
        (bytes memory middle, bytes memory image, string memory mediaType) = _render(p);
        bytes memory prefix = rawPrefix;
        bytes memory suffix = rawSuffix;
        if (prefix.length == 0 || prefix[0] != "{" || !_endsWith(prefix, bytes('"animation_url":"data:text/html;charset=utf-8,'))
            || suffix.length == 0 || suffix[suffix.length - 1] != "}"
            || !_contains(prefix, bytes.concat(bytes('"image":"data:'), bytes(mediaType), bytes(';base64,'), bytes(Base64.encode(image)), bytes('"')))) revert InvalidEnvelope();
        bytes memory result = bytes.concat(bytes("data:application/json;charset=utf-8,"), KeelUriEscape.escape(prefix), middle, KeelUriEscape.escape(suffix));
        if (result.length > MAX_RENDERED_BYTES) revert InvalidEnvelope();
        return string(result);
    }

    function preEncodedTokenJSONMiddle(bytes32 objectId, bytes32 digest) public view returns (bytes memory) {
        (bytes memory middle,,) = _render(_program(objectId, digest));
        return _decodePercent(middle);
    }
    function harnessInlineURIWithContext(bytes32 objectId, bytes32 digest, bytes calldata contextJSON) external view returns (string memory) {
        return string(bytes.concat(bytes("data:text/html;charset=utf-8,"), preEncodedTokenJSONMiddle(objectId, digest), contextURI(contextJSON)));
    }
    function harnessInlineURI(bytes32 objectId, bytes32 digest) external view returns (string memory) {
        return string(bytes.concat(bytes("data:text/html;charset=utf-8,"), preEncodedTokenJSONMiddle(objectId, digest)));
    }

    function _program(bytes32 objectId, bytes32 digest) private view returns (Program memory p) {
        IKeelHold.ObjectRecord memory record = keelHold.getObject(objectId);
        if (objectId == bytes32(0) || digest == bytes32(0) || !record.exists || record.digest != digest
            || record.compression != IKeelHold.Compression.None || record.byteLength > 32768 || keccak256(bytes(record.mediaType)) != PROGRAM_MEDIA) revert InvalidProgram();
        bytes memory body = keelHold.haulObject(objectId);
        if (body.length != record.byteLength || sha256(body) != digest) revert InvalidProgram();
        // The ABI is a flat tuple; encode/decode one struct wraps dynamic tuples.
        (p.profile,p.renderedBytes,p.renderedDigest,p.imageObjectId,p.imageDigest,p.imageBytes,p.objectIds,p.digests,p.modes) = abi.decode(body,(bytes32,uint256,bytes32,bytes32,bytes32,uint256,bytes32[],bytes32[],uint8[]));
        if (sha256(abi.encode(p.profile,p.renderedBytes,p.renderedDigest,p.imageObjectId,p.imageDigest,p.imageBytes,p.objectIds,p.digests,p.modes)) != digest) revert InvalidProgram();
        if (p.profile != PROGRAM_PROFILE || p.renderedBytes == 0 || p.renderedBytes > MAX_RENDERED_BYTES || p.imageBytes == 0 || p.imageBytes > MAX_RENDERED_BYTES
            || p.imageObjectId == bytes32(0) || p.imageDigest == bytes32(0) || p.renderedDigest == bytes32(0)
            || p.objectIds.length == 0 || p.objectIds.length > 128 || p.objectIds.length != p.digests.length || p.objectIds.length != p.modes.length) revert InvalidProgram();
    }

    function _render(Program memory p) private view returns (bytes memory output, bytes memory image, string memory mediaType) {
        IKeelHold.ObjectRecord memory imageRecord = keelHold.getObject(p.imageObjectId);
        mediaType = imageRecord.mediaType;
        bytes32 media = keccak256(bytes(mediaType));
        if (!imageRecord.exists || imageRecord.compression != IKeelHold.Compression.None || imageRecord.digest != p.imageDigest || imageRecord.byteLength != p.imageBytes
            || !(media == keccak256("image/png") || media == keccak256("image/jpeg") || media == keccak256("image/gif") || media == keccak256("image/webp") || media == keccak256("image/avif"))) revert InvalidBinding();
        if (4 * ((p.imageBytes + 2) / 3) > p.renderedBytes) revert InvalidBinding();
        image = keelHold.haulObject(p.imageObjectId);
        if (image.length != p.imageBytes || sha256(image) != p.imageDigest) revert InvalidBinding();
        bytes memory image64 = bytes(Base64.encode(image));
        output = new bytes(p.renderedBytes);
        uint256 cursor;
        uint256 imageSlots;
        for (uint256 index; index < p.objectIds.length; ++index) {
            bytes memory part;
            if (p.modes[index] == 1) {
                if (++imageSlots != 1 || p.objectIds[index] != p.imageObjectId || p.digests[index] != p.imageDigest) revert InvalidBinding();
                part = image64;
            } else if (p.modes[index] == 0) {
                IKeelHold.ObjectRecord memory record = keelHold.getObject(p.objectIds[index]);
                if (!record.exists || record.compression != IKeelHold.Compression.None || record.digest != p.digests[index]
                    || record.byteLength > output.length - cursor || keccak256(bytes(record.mediaType)) != COPY_MEDIA) revert InvalidBinding();
                part = keelHold.haulObject(p.objectIds[index]);
                if (part.length != record.byteLength || sha256(part) != p.digests[index]) revert InvalidBinding();
            } else revert InvalidProgram();
            if (part.length > output.length - cursor) revert InvalidBinding();
            assembly ("memory-safe") { mcopy(add(add(output, 32), cursor), add(part, 32), mload(part)) }
            cursor += part.length;
        }
        if (imageSlots != 1 || cursor != output.length || sha256(output) != p.renderedDigest) revert InvalidBinding();
    }

    function _endsWith(bytes memory value, bytes memory suffix) private pure returns (bool) {
        if (suffix.length > value.length) return false;
        for (uint256 i; i < suffix.length; ++i) if (value[value.length - suffix.length + i] != suffix[i]) return false;
        return true;
    }
    function _contains(bytes memory value, bytes memory expected) private pure returns (bool) {
        if (expected.length > value.length) return false;
        for (uint256 i; i <= value.length - expected.length; ++i) {
            bool match_ = true;
            for (uint256 j; j < expected.length; ++j) if (value[i + j] != expected[j]) { match_ = false; break; }
            if (match_) return true;
        }
        return false;
    }
    function _decodePercent(bytes memory value) private pure returns (bytes memory output) {
        output = new bytes(value.length);
        uint256 cursor;
        for (uint256 index; index < value.length; ++index) {
            if (value[index] == "%") {
                if (index + 2 >= value.length) revert InvalidProgram();
                output[cursor++] = bytes1((_hex(value[index + 1]) << 4) | _hex(value[index + 2]));
                index += 2;
            } else output[cursor++] = value[index];
        }
        assembly ("memory-safe") { mstore(output, cursor) }
    }
    function _hex(bytes1 value) private pure returns (uint8) {
        uint8 c = uint8(value);
        if (c >= 48 && c <= 57) return c - 48;
        if (c >= 65 && c <= 70) return c - 55;
        revert InvalidProgram();
    }
}
