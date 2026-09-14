import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import solc from 'solc';
import {createPublicClient,createWalletClient,http,encodeDeployData,sha256} from 'viem';

const root='apps/desktop/artifacts/gator-base-cross-chain-test';
await mkdir(root,{recursive:true});
const recipient='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0';
const live=JSON.parse(await readFile('apps/desktop/artifacts/gator-inline-sepolia/live-token-0/public-readback/proof.json','utf8'));
assert.equal(live.activated,true);assert.equal(live.chainId,11155111);
assert.equal(live.tokenURI,'web3://0x491b0da450f990bd5026ca9f0b5c244f16a5e718:11155111/tokenJSON/0?mime.type=json');
const source=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
/// @notice One Base test token referring to existing KEEL metadata on Sepolia.
contract KeelCrossChainGatorTest is ERC721 {
    constructor(address recipient) ERC721("KEEL Cross-chain Gator Test", "KGTEST") {
        _mint(recipient, 0);
    }
    function totalSupply() external pure returns (uint256) { return 1; }
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return "${live.tokenURI}";
    }
}
`;
const sources={'KeelCrossChainGatorTest.sol':{content:source}};
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:50},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','metadata']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>{
 try {const content=readFileSync(fileURLToPath(import.meta.resolve(path)),'utf8');sources[path]={content};return {contents:content};}
 catch{return {error:'Missing Solidity import: '+path};}
}}));
assert.deepEqual((output.errors??[]).filter(e=>e.severity==='error'),[]);
const artifact=output.contracts['KeelCrossChainGatorTest.sol'].KeelCrossChainGatorTest;
await writeFile(root+'/KeelCrossChainGatorTest.sol',source);
await writeFile(root+'/solc-input.json',JSON.stringify(input,null,2));
await writeFile(root+'/compiled.json',JSON.stringify(artifact,null,2));
const data=encodeDeployData({abi:artifact.abi,bytecode:'0x'+artifact.evm.bytecode.object,args:[recipient]});
await writeFile(root+'/deployment-data.txt',data);
const child=spawn('anvil',['--port','0','--chain-id','31337'],{stdio:['ignore','pipe','pipe']});
try {
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Local EVM startup timeout')),15000);child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);reject(Error('Local EVM exited'));});child.stdout.on('data',chunk=>{out+=chunk;const match=out.match(/Listening on (127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve('http://'+match[1]);}});});
 const c=createPublicClient({transport:http(url)}),w=createWalletClient({transport:http(url)});
 const [account,other]=await w.getAddresses();
 const r=await c.waitForTransactionReceipt({hash:await w.sendTransaction({account,chain:null,data})});
 assert.equal(r.status,'success');
 const read=(functionName,args=[])=>c.readContract({address:r.contractAddress,abi:artifact.abi,functionName,args});
 assert.equal(await read('tokenURI',[0n]),live.tokenURI);assert.equal(await read('ownerOf',[0n]),recipient);
 assert.equal(await read('totalSupply'),1n);assert.equal(await read('balanceOf',[recipient]),1n);
 for(const id of ['0x01ffc9a7','0x80ac58cd','0x5b5e139f'])assert.equal(await read('supportsInterface',[id]),true);
 assert.equal(await read('supportsInterface',['0xffffffff']),false);
 await assert.rejects(read('tokenURI',[1n]));
 await assert.rejects(c.simulateContract({account:other,address:r.contractAddress,abi:artifact.abi,functionName:'transferFrom',args:[recipient,other,0n]}));
 const report={checkedAt:new Date().toISOString(),compiler:solc.version(),targetChainId:8453,metadataChainId:11155111,recipient,tokenId:0,tokenURI:live.tokenURI,localTestsPassed:true,deployGas:String(r.gasUsed),runtimeBytes:artifact.evm.deployedBytecode.object.length/2,initDataDigest:sha256(data),liveMetadataDigest:live.jsonDigest,publicChainPublished:false};
 await writeFile(root+'/preparation.json',JSON.stringify(report,null,2));console.log(report);
} finally {child.kill('SIGTERM');}
