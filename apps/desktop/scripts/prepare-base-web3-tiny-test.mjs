/** Minimal PNG fixture and URI controls, with no dependency on KEEL or another chain. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {deflateSync,inflateSync} from 'node:zlib';
import solc from 'solc';
import {createPublicClient,createWalletClient,http,encodeDeployData,sha256} from 'viem';
const root='apps/desktop/artifacts/base-web3-16x16-test',recipient='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0';
await mkdir(root,{recursive:true});
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let bit=0;bit<8;bit++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,bytes){const body=Buffer.concat([Buffer.from(type),bytes]),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([length,body,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(16,0);header.writeUInt32BE(16,4);header[8]=8;header[9]=2;
const pixels=Buffer.concat(Array.from({length:16},()=>Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:16},()=>[56,62,123]).flat())])));
const compressed=deflateSync(pixels,{level:9});assert.deepEqual(inflateSync(compressed),pixels);
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND',Buffer.alloc(0))]);
const metadata=JSON.stringify({name:'KEEL 16x16 Blue',description:'Minimal Base web3 URI compatibility test.',image:'data:image/png;base64,'+png.toString('base64')});
const inlineURI='data:application/json;base64,'+Buffer.from(metadata).toString('base64');
const tests=[{tokenId:0,lane:'web3-plain',tokenURI:'web3://{address}:8453/tokenJSON/0'},{tokenId:1,lane:'web3-mime',tokenURI:'web3://{address}:8453/tokenJSON/1?mime.type=json'},{tokenId:2,lane:'inline-control',tokenURI:inlineURI}];
const source=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
contract BaseWeb3TinyTest is ERC721 {
 constructor(address recipient) ERC721("KEEL Tiny Web3 Test", "KWEB3") { for(uint256 i; i<3; ++i) _mint(recipient,i); }
 function totalSupply() external pure returns(uint256) { return 3; }
 function tokenURI(uint256 id) public view override returns(string memory) {
  _requireOwned(id);
  if(id==2) return ${JSON.stringify(inlineURI)};
  return string.concat("web3://",Strings.toHexString(address(this)),":8453/tokenJSON/",Strings.toString(id),id==1?"?mime.type=json":"");
 }
 function tokenJSON(uint256 id) external view returns(string memory) { _requireOwned(id); return ${JSON.stringify(metadata)}; }
}
`;
const sources={'BaseWeb3TinyTest.sol':{content:source}},input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:50},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','metadata']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>{try{const content=readFileSync(fileURLToPath(import.meta.resolve(path)),'utf8');sources[path]={content};return {contents:content};}catch{return {error:'Missing import: '+path};}}}));
assert.deepEqual((output.errors??[]).filter(e=>e.severity==='error'),[]);
const artifact=output.contracts['BaseWeb3TinyTest.sol'].BaseWeb3TinyTest,data=encodeDeployData({abi:artifact.abi,bytecode:'0x'+artifact.evm.bytecode.object,args:[recipient]});
for(const [file,content] of Object.entries({'BaseWeb3TinyTest.sol':source,'solc-input.json':JSON.stringify(input,null,2),'compiled.json':JSON.stringify(artifact,null,2),'deployment-data.txt':data,'metadata.json':metadata,'color.png':png}))await writeFile(root+'/'+file,content);
const child=spawn('anvil',['--port','0','--chain-id','31337','--prune-history'],{stdio:['ignore','pipe','pipe']});
try {
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Local EVM startup timeout')),15000);child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);reject(Error('Local EVM exited'));});child.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const c=createPublicClient({transport:http(url)}),w=createWalletClient({transport:http(url)}),[account,other]=await w.getAddresses();
 const r=await c.waitForTransactionReceipt({hash:await w.sendTransaction({account,chain:null,data})});assert.equal(r.status,'success');
 const read=(functionName,args=[])=>c.readContract({address:r.contractAddress,abi:artifact.abi,functionName,args});
 for(const test of tests){assert.equal(await read('ownerOf',[BigInt(test.tokenId)]),recipient);assert.equal(await read('tokenURI',[BigInt(test.tokenId)]),test.tokenURI.replaceAll('{address}',r.contractAddress.toLowerCase()));assert.equal(await read('tokenJSON',[BigInt(test.tokenId)]),metadata);}
 assert.equal(await read('totalSupply'),3n);await assert.rejects(read('tokenURI',[3n]));await assert.rejects(read('tokenJSON',[3n]));
 await assert.rejects(c.simulateContract({account:other,address:r.contractAddress,abi:artifact.abi,functionName:'transferFrom',args:[recipient,other,0n]}));
 const report={checkedAt:new Date().toISOString(),compiler:solc.version(),targetChainId:8453,metadataChainId:8453,recipient,tokenId:0,tokenURI:tests[0].tokenURI,tests,pngBytes:png.length,jsonBytes:Buffer.byteLength(metadata),localTestsPassed:true,deployGas:String(r.gasUsed),runtimeBytes:artifact.evm.deployedBytecode.object.length/2,initDataDigest:sha256(data),publicChainPublished:false};
 await writeFile(root+'/preparation.json',JSON.stringify(report,null,2));console.log({...report,tests:tests.map(t=>({tokenId:t.tokenId,lane:t.lane}))});
} finally {child.kill('SIGTERM');}
