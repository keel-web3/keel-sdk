// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Implement this in an audited collection adapter. A registry boolean cannot freeze another contract.
interface IKeelLayerAllocation {
    function layerAllocation() external view returns (bytes32 manifest, bytes32 allocation, uint256 supply, bool frozen);
    function layerTokenExists(uint256 tokenId) external view returns (bool);
}
interface ILayerVRFCoordinator {
    struct RandomWordsRequest { bytes32 keyHash; uint256 subId; uint16 requestConfirmations; uint32 callbackGasLimit; uint32 numWords; bytes extraArgs; }
    function requestRandomWords(RandomWordsRequest calldata request) external returns (uint256 requestId);
}
/// Immutable, one-shot reveal. No owner retry, cancellation, coordinator change or fallback entropy.
/// Encryption-key availability and the collection adapter remain separate trust boundaries.
contract KeelLayerReveal {
    enum Mode { Creator, FutureBlock, Chainlink }
    address public immutable creator;
    IKeelLayerAllocation public immutable collection;
    bytes32 public immutable manifestDigest;
    bytes32 public immutable allocationDigest;
    bytes32 public immutable ciphertextDigest;
    bytes32 public immutable keyCommitment;
    bytes32 public immutable creatorSeedCommitment;
    uint256 public immutable supply;
    uint256 public immutable revealAt;
    Mode public immutable mode;
    address public immutable coordinator;
    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint16 public immutable confirmations;
    uint32 public immutable callbackGasLimit;
    bool public immutable nativePayment;
    bool public requested;
    bool public fulfilled;
    bool public keyPublished;
    uint256 public requestId;
    uint256 public drawBlock;
    bytes32 public rootSeed;
    bytes32 public revealKey;
    struct Config {
        address creator; address collection; bytes32 manifestDigest; bytes32 allocationDigest;
        bytes32 ciphertextDigest; bytes32 keyCommitment; bytes32 creatorSeedCommitment;
        uint256 supply; uint256 revealAt; Mode mode; address coordinator; bytes32 keyHash;
        uint256 subscriptionId; uint16 confirmations; uint32 callbackGasLimit; bool nativePayment;
    }
    event Requested(uint256 requestId, uint256 drawBlock);
    event SeedFinalized(bytes32 rootSeed);
    event KeyPublished(bytes32 key);
    constructor(Config memory c) {
        require(c.creator != address(0) && c.collection.code.length > 0 && c.supply > 0, "Invalid identities");
        require(c.manifestDigest != 0 && c.allocationDigest != 0, "Commit artwork and allocation");
        require((c.ciphertextDigest == 0) == (c.keyCommitment == 0), "Incomplete encryption commitment");
        if(c.mode == Mode.Creator) require(c.creatorSeedCommitment != 0, "Commit creator seed");
        if(c.mode == Mode.Chainlink) require(c.coordinator.code.length > 0 && c.keyHash != 0 && c.confirmations > 0 && c.confirmations <= 200 && c.callbackGasLimit >= 70000, "Invalid VRF setup");
        creator=c.creator; collection=IKeelLayerAllocation(c.collection); manifestDigest=c.manifestDigest; allocationDigest=c.allocationDigest;
        ciphertextDigest=c.ciphertextDigest; keyCommitment=c.keyCommitment; creatorSeedCommitment=c.creatorSeedCommitment;
        supply=c.supply; revealAt=c.revealAt; mode=c.mode; coordinator=c.coordinator; keyHash=c.keyHash;
        subscriptionId=c.subscriptionId; confirmations=c.confirmations; callbackGasLimit=c.callbackGasLimit; nativePayment=c.nativePayment;
    }
    function allocationReady() public view returns (bool) {
        (bytes32 m,bytes32 a,uint256 n,bool frozen)=collection.layerAllocation();
        return frozen && m==manifestDigest && a==allocationDigest && n==supply;
    }
    function requestReveal() external {
        require(msg.sender==creator && !requested && allocationReady(), "Freeze allocation before draw");
        require(block.timestamp>=revealAt, "Reveal is not open");
        requested=true;
        if(mode==Mode.FutureBlock) drawBlock=block.number+2;
        if(mode==Mode.Chainlink) requestId=ILayerVRFCoordinator(coordinator).requestRandomWords(ILayerVRFCoordinator.RandomWordsRequest({
            keyHash:keyHash,subId:subscriptionId,requestConfirmations:confirmations,callbackGasLimit:callbackGasLimit,numWords:1,
            extraArgs:abi.encodeWithSelector(bytes4(keccak256("VRF ExtraArgsV1")),nativePayment)
        }));
        emit Requested(requestId,drawBlock);
    }
    function revealCreatorSeed(bytes32 secret) external {
        require(mode==Mode.Creator && requested && !fulfilled && sha256(abi.encodePacked(secret))==creatorSeedCommitment, "Invalid committed seed");
        _finalize(secret);
    }
    function settleFutureBlock() external {
        require(mode==Mode.FutureBlock && requested && !fulfilled && block.number>drawBlock && block.number<=drawBlock+256, "Draw unavailable; no reroll");
        bytes32 value=blockhash(drawBlock);require(value!=0,"Draw hash unavailable");_finalize(value);
    }
    function rawFulfillRandomWords(uint256 id,uint256[] calldata words) external {
        require(msg.sender==coordinator && mode==Mode.Chainlink && requested && id==requestId && !fulfilled && words.length==1, "Unexpected VRF fulfillment");
        // Zero is a valid VRF output. Callback only writes state and emits; no collection calls.
        _finalize(bytes32(words[0]));
    }
    function _finalize(bytes32 value) private { fulfilled=true;rootSeed=value;emit SeedFinalized(value); }
    function publishKey(bytes32 key) external {
        require(fulfilled && block.timestamp>=revealAt && !keyPublished && keyCommitment!=0 && allocationReady(), "Key release is not ready");
        require(sha256(abi.encodePacked(key))==keyCommitment,"Wrong key");keyPublished=true;revealKey=key;emit KeyPublished(key);
    }
    function seedOf(uint256 tokenId) external view returns(bytes32) {
        require(fulfilled && allocationReady() && tokenId>0 && tokenId<=supply && collection.layerTokenExists(tokenId),"Token reveal unavailable");
        return keccak256(abi.encode("keel-layered-token@1",block.chainid,address(this),address(collection),manifestDigest,allocationDigest,supply,rootSeed,tokenId));
    }
}
