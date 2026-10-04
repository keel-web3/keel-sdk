import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import solc from 'solc';
import {createPublicClient,createWalletClient,http,encodeDeployData,sha256} from 'viem';
const endpoint=process.argv.includes('--sepolia-endpoint');
const root='apps/desktop/artifacts/'+(endpoint?'sepolia-web3-16x16-test':'base-web3-cross-chain-comparison');
const recipient='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0';
await mkdir(root,{recursive:true});
const metadata=await readFile('apps/desktop/artifacts/base-web3-16x16-test/metadata.json','utf8');
assert.equal(Buffer.byteLength(metadata),225);
const tests=[];
if(!endpoint){
 const sepolia=JSON.parse(await readFile('apps/desktop/artifacts/sepolia-web3-16x16-test/publication.json','utf8'));
 assert.equal(sepolia.publicChainPublished,true);assert.equal(sepolia.metadataDigest,sha256(Buffer.from(metadata)));
 const mainnet=JSON.parse(await readFile('apps/desktop/artifacts/base-mainnet-web3-test/endpoint.json','utf8'));
 tests.push({tokenId:0,lane:'base-to-sepolia-plain',tokenURI:sepolia.tokenURI},{tokenId:1,lane:'base-to-sepolia-mime',tokenURI:sepolia.tokenURI+'?mime.type=json'},{tokenId:2,lane:'base-to-mainnet',tokenURI:mainnet.tokenURI});
}
const name=endpoint?'TinyBlueMetadata':'TinyCrossChainComparison';
const source=endpoint?`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract TinyBlueMetadata {
 function tokenJSON(uint256) external pure returns(string memory) { return ${JSON.stringify(metadata)}; }
}
`:`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
contract TinyCrossChainComparison is ERC721 {
 constructor(address recipient) ERC721("KEEL Cross-chain URI Test", "KCROSS") { for(uint256 i; i<3; ++i) _mint(recipient,i); }
 function totalSupply() external pure returns(uint256) { return 3; }
 function tokenURI(uint256 id) public view override returns(string memory) {
  _requireOwned(id);
  ${tests.map(t=>`if(id==${t.tokenId}) return ${JSON.stringify(t.tokenURI)};`).join('\n  ')}
  revert();
 }
}
`;
const file=name+'.sol',sources={[file]:{content:source}},input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:50},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','metadata']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>{try{const content=readFileSync(fileURLToPath(import.meta.resolve(path)),'utf8');sources[path]={content};return {contents:content};}catch{return {error:'Missing import: '+path};}}}));
assert.deepEqual((output.errors??[]).filter(e=>e.severity==='error'),[]);
const artifact=output.contracts[file][name],data=encodeDeployData({abi:artifact.abi,bytecode:'0x'+artifact.evm.bytecode.object,args:endpoint?[]:[recipient]});
for(const [file,content] of Object.entries({[name+'.sol']:source,'solc-input.json':JSON.stringify(input,null,2),'compiled.json':JSON.stringify(artifact,null,2),'deployment-data.txt':data,'metadata.json':metadata}))await writeFile(root+'/'+file,content);
const child=spawn('anvil',['--port','0','--chain-id','31337','--prune-history'],{stdio:['ignore','pipe','pipe']});
try{
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Local EVM startup timeout')),15000);child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);reject(Error('Local EVM exited'));});child.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const c=createPublicClient({transport:http(url)}),w=createWalletClient({transport:http(url)}),[account]=await w.getAddresses();
 const receipt=await c.waitForTransactionReceipt({hash:await w.sendTransaction({account,chain:null,data})});assert.equal(receipt.status,'success');
 const read=(functionName,args=[])=>c.readContract({address:receipt.contractAddress,abi:artifact.abi,functionName,args});
 if(endpoint)assert.equal(await read('tokenJSON',[0n]),metadata);
 else{for(const t of tests){assert.equal(await read('ownerOf',[BigInt(t.tokenId)]),recipient);assert.equal(await read('tokenURI',[BigInt(t.tokenId)]),t.tokenURI);}assert.equal(await read('totalSupply'),3n);await assert.rejects(read('tokenURI',[3n]));}
 const report={checkedAt:new Date().toISOString(),compiler:solc.version(),targetChainId:endpoint?11155111:8453,metadataChainId:endpoint?11155111:[11155111,1],recipient,tests,tokenURI:tests[0]?.tokenURI??null,localTestsPassed:true,deployGas:String(receipt.gasUsed),initDataDigest:sha256(data),metadataDigest:sha256(Buffer.from(metadata)),jsonBytes:225,publicChainPublished:false};
 await writeFile(root+'/preparation.json',JSON.stringify(report,null,2));console.log(report);
}finally{child.kill('SIGTERM');}
