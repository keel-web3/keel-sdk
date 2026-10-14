// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;
import {IKeelHold} from "@keel/keel-hold/interfaces/IKeelHold.sol";
contract LocalIngot { constructor(bytes memory payload) { bytes memory runtime = bytes.concat(hex"00", payload); assembly ("memory-safe") { return(add(runtime, 32), mload(runtime)) } } }
/// Synthetic storage/registration adapter only. Production Hold upload/seal policy is not simulated.
contract LocalHold {
    mapping(bytes32 => IKeelHold.ObjectRecord) private records;
    mapping(bytes32 => address[]) private carriers;
    mapping(bytes32 => mapping(address => bool)) public registered;
    mapping(bytes32 => bytes) private corruptions;
    uint256 public payloadBytes;
    uint256 public putCount;
    function append(bytes32 id, bytes calldata value) external {
        require(!records[id].exists && value.length > 0 && value.length <= 23000);
        carriers[id].push(address(new LocalIngot(value)));
        payloadBytes += value.length;
    }
    function finish(bytes32 id, bytes32 digest, uint64 length, string calldata mediaType) external {
        require(!records[id].exists && carriers[id].length != 0);
        records[id] = IKeelHold.ObjectRecord({digest:digest,indexDigest:bytes32(0),descriptorPointer:address(0),byteLength:length,storedByteLength:length,slugCount:uint32(carriers[id].length),compression:IKeelHold.Compression.None,composite:false,exists:true,mediaType:mediaType});
        putCount++;
    }
    function register(bytes32 id, address renderer) external { require(records[id].exists); registered[id][renderer] = true; }
    function requireHarness(bytes32 id, address renderer) external view { require(registered[id][renderer], "UNREGISTERED"); }
    function getObject(bytes32 id) external view returns(IKeelHold.ObjectRecord memory) { return records[id]; }
    function haulObject(bytes32 id) external view returns(bytes memory output) {
        if (corruptions[id].length != 0) return corruptions[id];
        output = new bytes(records[id].byteLength); uint256 cursor;
        for(uint256 i; i < carriers[id].length; i++) {
            address pointer = carriers[id][i]; uint256 length = pointer.code.length - 1;
            assembly ("memory-safe") { extcodecopy(pointer, add(add(output,32),cursor),1,length) }
            cursor += length;
        }
    }
    function corrupt(bytes32 id, bytes calldata value) external { corruptions[id] = value; }
}
