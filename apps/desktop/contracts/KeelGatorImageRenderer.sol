// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGatorHold { function getSlug(bytes32 id) external view returns(bytes memory); }
interface IGatorCollection { function ownerOf(uint256 id) external view returns(address); }

/// @notice Direct image adapter for a frozen original collection; PNG bytes remain raw in KEEL.
/// A recipe is the ordered list of descriptor hashes. A descriptor is the ordered list
/// of raw PNG chunk hashes. All non-final PNG chunks must have a byte length divisible by 3.
/// ERC-7617 concatenates bounded response bodies into one script-free SVG image.
contract KeelGatorImageRenderer {
    struct KeyValue { string key; string value; }
    struct Token { bytes32 metadata; bytes32 recipe; }
    IGatorHold public immutable hold;
    IGatorCollection public immutable collection;
    address public immutable owner;
    uint256 public immutable supply;
    uint256 public immutable dimension;
    mapping(uint256 => Token) public tokens;
    error Invalid();
    error Unauthorized();
    constructor(address hold_,address collection_,uint256 supply_,uint256 dimension_) {
        if(hold_.code.length==0||collection_.code.length==0||supply_==0||dimension_==0||dimension_>8192)revert Invalid();
        hold=IGatorHold(hold_);collection=IGatorCollection(collection_);owner=msg.sender;supply=supply_;dimension=dimension_;
    }
    function setTokens(uint256 start,Token[] calldata entries) external {
        if(msg.sender!=owner)revert Unauthorized();
        if(entries.length==0||entries.length>100||start+entries.length>supply)revert Invalid();
        for(uint256 i;i<entries.length;i++){
            if(entries[i].metadata==0||entries[i].recipe==0)revert Invalid();
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
    function imageChunk(uint256 id,uint256 layer,uint256 chunk) public view returns(string memory body,bool more,uint256 nextLayer,uint256 nextChunk){
        bytes memory recipe=hold.getSlug(_token(id).recipe);
        if(recipe.length==0||recipe.length%32!=0||recipe.length>2048||layer>=recipe.length/32)revert Invalid();
        bytes memory descriptor=hold.getSlug(_word(recipe,layer));
        if(descriptor.length==0||descriptor.length%32!=0||descriptor.length>23000||chunk>=descriptor.length/32)revert Invalid();
        bytes memory raw=hold.getSlug(_word(descriptor,chunk));
        bool lastChunk=chunk+1==descriptor.length/32;bool lastLayer=layer+1==recipe.length/32;
        if(raw.length==0||raw.length>23000||(!lastChunk&&raw.length%3!=0))revert Invalid();
        if(chunk==0&&(raw.length<8||bytes8(_wordAt(raw,0))!=0x89504e470d0a1a0a))revert Invalid();
        string memory prefix=layer==0&&chunk==0?string.concat('<svg xmlns="http://www.w3.org/2000/svg" width="',_decimal(dimension),'" height="',_decimal(dimension),'" viewBox="0 0 ',_decimal(dimension),' ',_decimal(dimension),'">'):"";
        if(chunk==0)prefix=string.concat(prefix,'<image width="',_decimal(dimension),'" height="',_decimal(dimension),'" href="data:image/png;base64,');
        body=string.concat(prefix,_base64(raw),lastChunk?'"/>':"",lastChunk&&lastLayer?'</svg>':"");
        more=!(lastChunk&&lastLayer);nextLayer=lastChunk?layer+1:layer;nextChunk=lastChunk?0:chunk+1;
    }
    function request(string[] memory resource,KeyValue[] memory) external view returns(uint16,string memory,KeyValue[] memory headers){
        if(resource.length<2)return _text(400,"Choose a token resource");
        uint256 id=_parse(resource[1]);
        if(keccak256(bytes(resource[0]))==keccak256("tokenJSON")&&resource.length==2){headers=new KeyValue[](1);headers[0]=KeyValue("Content-Type","application/json");return(200,tokenJSON(id),headers);}
        if(keccak256(bytes(resource[0]))!=keccak256("image")||(resource.length!=2&&resource.length!=4))return _text(404,"Unknown resource");
        uint256 layer=resource.length==4?_parse(resource[2]):0;uint256 chunk=resource.length==4?_parse(resource[3]):0;
        (string memory body,bool more,uint256 nextLayer,uint256 nextChunk)=imageChunk(id,layer,chunk);
        headers=new KeyValue[](more?2:1);headers[0]=KeyValue("Content-Type","image/svg+xml");
        if(more)headers[1]=KeyValue("web3-next-chunk",string.concat("/image/",_decimal(id),"/",_decimal(nextLayer),"/",_decimal(nextChunk)));
        return(200,body,headers);
    }
    function _token(uint256 id) private view returns(Token memory t){if(id>=supply||collection.ownerOf(id)==address(0))revert Invalid();t=tokens[id];if(t.metadata==0||t.recipe==0)revert Invalid();}
    function _word(bytes memory b,uint256 i) private pure returns(bytes32){if((i+1)*32>b.length)revert Invalid();return _wordAt(b,i*32);}
    function _wordAt(bytes memory b,uint256 offset) private pure returns(bytes32 out){assembly("memory-safe"){out:=mload(add(add(b,32),offset))}}
    function _slice(bytes memory b,uint256 start,uint256 length) private pure returns(bytes memory out){out=new bytes(length);for(uint256 i;i<length;i++)out[i]=b[start+i];}
    function _base64(bytes memory data) private pure returns(string memory){
        bytes memory table="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";bytes memory out=new bytes(4*((data.length+2)/3));uint256 p;
        for(uint256 i;i<data.length;i+=3){uint256 v=uint256(uint8(data[i]))<<16;if(i+1<data.length)v|=uint256(uint8(data[i+1]))<<8;if(i+2<data.length)v|=uint8(data[i+2]);out[p++]=table[(v>>18)&63];out[p++]=table[(v>>12)&63];out[p++]=i+1<data.length?table[(v>>6)&63]:bytes1('=');out[p++]=i+2<data.length?table[v&63]:bytes1('=');}return string(out);
    }
    function _parse(string memory value) private pure returns(uint256 n){bytes memory b=bytes(value);if(b.length==0||b.length>10)revert Invalid();for(uint256 i;i<b.length;i++){if(b[i]<'0'||b[i]>'9')revert Invalid();n=n*10+uint8(b[i])-48;}}
    function _decimal(uint256 n) private pure returns(string memory){if(n==0)return "0";uint256 x=n;uint256 length;while(x>0){length++;x/=10;}bytes memory b=new bytes(length);while(n>0){b[--length]=bytes1(uint8(48+n%10));n/=10;}return string(b);}
    function _address(address a) private pure returns(string memory){bytes memory b=new bytes(42);b[0]='0';b[1]='x';bytes memory h="0123456789abcdef";for(uint256 i;i<20;i++){uint8 v=uint8(uint160(a)>>(8*(19-i)));b[2+i*2]=h[v>>4];b[3+i*2]=h[v&15];}return string(b);}
    function _text(uint16 code,string memory body) private pure returns(uint16,string memory,KeyValue[] memory h){h=new KeyValue[](1);h[0]=KeyValue("Content-Type","text/plain");return(code,body,h);}
}
