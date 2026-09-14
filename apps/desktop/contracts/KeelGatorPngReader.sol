// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPngHold { function getSlug(bytes32 id) external view returns(bytes memory); }
interface IPngCollection { function ownerOf(uint256 id) external view returns(address); }

/// @notice Returns an already encoded PNG from KEEL raw chunks. No SVG or artwork JavaScript.
/// This proves PNG delivery only; it does not composite separate image layers onchain.
/// The descriptor can reference editor-prepared reusable IDAT strips, with a PNG header/footer.
contract KeelGatorPngReader {
    struct KeyValue { string key; string value; }
    struct Token { bytes32 metadata; bytes32 png; }
    IPngHold public immutable hold;
    IPngCollection public immutable collection;
    address public immutable owner;
    uint256 public immutable supply;
    uint256 public immutable dimension;
    mapping(uint256 => Token) public tokens;
    error Invalid();
    error Unauthorized();
    constructor(address hold_,address collection_,uint256 supply_,uint256 dimension_) {
        if(hold_.code.length==0||collection_.code.length==0||supply_==0||dimension_==0||dimension_>8192)revert Invalid();
        hold=IPngHold(hold_);collection=IPngCollection(collection_);owner=msg.sender;supply=supply_;dimension=dimension_;
    }
    function setTokens(uint256 start,Token[] calldata entries) external {
        if(msg.sender!=owner)revert Unauthorized();
        if(entries.length==0||entries.length>100||start+entries.length>supply)revert Invalid();
        for(uint256 i;i<entries.length;i++){
            if(entries[i].metadata==0||entries[i].png==0)revert Invalid();
            tokens[start+i]=entries[i];
        }
    }
    function resolveMode() external pure returns(bytes32){return "5219";}
    function tokenJSON(uint256 id) public view returns(string memory){
        Token memory t=_token(id);bytes memory envelope=hold.getSlug(t.metadata);
        // Two-byte big-endian length, original JSON prefix, original JSON suffix.
        if(envelope.length<2)revert Invalid();uint256 n=(uint256(uint8(envelope[0]))<<8)|uint8(envelope[1]);
        if(n+2>envelope.length)revert Invalid();
        return string.concat(string(_slice(envelope,2,n)),"web3://",_address(address(this)),":",_decimal(block.chainid),"/image/",_decimal(id),string(_slice(envelope,n+2,envelope.length-n-2)));
    }
    function pngChunk(uint256 id,uint256 chunk) public view returns(bytes memory body,bool more){
        bytes memory descriptor=hold.getSlug(_token(id).png);
        if(descriptor.length==0||descriptor.length%32!=0||descriptor.length>23000||chunk>=descriptor.length/32)revert Invalid();
        body=hold.getSlug(_word(descriptor,chunk));
        if(body.length==0||body.length>23000)revert Invalid();
        if(chunk==0&&(body.length<8||bytes8(_wordAt(body,0))!=0x89504e470d0a1a0a))revert Invalid();
        more=chunk+1<descriptor.length/32;
    }
    function pngPage(uint256 id,uint256 start) public view returns(bytes memory body,uint256 next){
        bytes memory descriptor=hold.getSlug(_token(id).png);
        if(descriptor.length==0||descriptor.length%32!=0||descriptor.length>23000||start>=descriptor.length/32)revert Invalid();
        uint256 end=start+8;if(end>descriptor.length/32)end=descriptor.length/32;
        body=_join(descriptor,start,end);next=end<descriptor.length/32?end:0;
        if(start==0&&(body.length<8||bytes8(_wordAt(body,0))!=0x89504e470d0a1a0a))revert Invalid();
    }
    /// Single eth_call comparison. Public RPC gas and response limits must be measured separately.
    function pngImage(uint256 id) external view returns(bytes memory body){
        bytes memory descriptor=hold.getSlug(_token(id).png);
        if(descriptor.length==0||descriptor.length%32!=0||descriptor.length>23000)revert Invalid();
        body=_join(descriptor,0,descriptor.length/32);
        if(body.length<8||bytes8(_wordAt(body,0))!=0x89504e470d0a1a0a)revert Invalid();
    }
    function _join(bytes memory descriptor,uint256 start,uint256 end) private view returns(bytes memory output){
        bytes[] memory parts=new bytes[](end-start);uint256 length;
        for(uint256 i=start;i<end;i++){bytes memory b=hold.getSlug(_word(descriptor,i));if(b.length==0||b.length>23000)revert Invalid();parts[i-start]=b;length+=b.length;}
        if(length>4_000_000)revert Invalid();output=new bytes(length);uint256 offset;
        for(uint256 i;i<parts.length;i++){bytes memory b=parts[i];
            assembly("memory-safe") {
                let source:=add(b,32)
                let destination:=add(add(output,32),offset)
                for {let j:=0} lt(j,mload(b)) {j:=add(j,32)} {mstore(add(destination,j),mload(add(source,j)))}
            }
            offset+=b.length;
        }
    }
    function request(string[] memory resource,KeyValue[] memory) external view returns(uint16,string memory,KeyValue[] memory headers){
        if(resource.length<2)return _text(400,"Choose a token resource");
        uint256 id=_parse(resource[1]);
        if(keccak256(bytes(resource[0]))==keccak256("tokenJSON")&&resource.length==2){headers=new KeyValue[](1);headers[0]=KeyValue("Content-Type","application/json");return(200,tokenJSON(id),headers);}
        if(keccak256(bytes(resource[0]))!=keccak256("image")||(resource.length!=2&&resource.length!=3))return _text(404,"Unknown resource");
        uint256 chunk=resource.length==3?_parse(resource[2]):0;
        (bytes memory body,uint256 next)=pngPage(id,chunk);
        headers=new KeyValue[](next!=0?2:1);headers[0]=KeyValue("Content-Type","image/png");
        if(next!=0)headers[1]=KeyValue("web3-next-chunk",string.concat("/image/",_decimal(id),"/",_decimal(next)));
        return(200,string(body),headers);
    }
    function _token(uint256 id) private view returns(Token memory t){if(id>=supply||collection.ownerOf(id)==address(0))revert Invalid();t=tokens[id];if(t.metadata==0||t.png==0)revert Invalid();}
    function _word(bytes memory b,uint256 i) private pure returns(bytes32){if((i+1)*32>b.length)revert Invalid();return _wordAt(b,i*32);}
    function _wordAt(bytes memory b,uint256 offset) private pure returns(bytes32 out){assembly("memory-safe"){out:=mload(add(add(b,32),offset))}}
    function _slice(bytes memory b,uint256 start,uint256 length) private pure returns(bytes memory out){out=new bytes(length);for(uint256 i;i<length;i++)out[i]=b[start+i];}
    function _parse(string memory value) private pure returns(uint256 n){bytes memory b=bytes(value);if(b.length==0||b.length>10)revert Invalid();for(uint256 i;i<b.length;i++){if(b[i]<'0'||b[i]>'9')revert Invalid();n=n*10+uint8(b[i])-48;}}
    function _decimal(uint256 n) private pure returns(string memory){if(n==0)return "0";uint256 x=n;uint256 length;while(x>0){length++;x/=10;}bytes memory b=new bytes(length);while(n>0){b[--length]=bytes1(uint8(48+n%10));n/=10;}return string(b);}
    function _address(address a) private pure returns(string memory){bytes memory b=new bytes(42);b[0]='0';b[1]='x';bytes memory h="0123456789abcdef";for(uint256 i;i<20;i++){uint8 v=uint8(uint160(a)>>(8*(19-i)));b[2+i*2]=h[v>>4];b[3+i*2]=h[v&15];}return string(b);}
    function _text(uint16 code,string memory body) private pure returns(uint16,string memory,KeyValue[] memory h){h=new KeyValue[](1);h[0]=KeyValue("Content-Type","text/plain");return(code,body,h);}
}
