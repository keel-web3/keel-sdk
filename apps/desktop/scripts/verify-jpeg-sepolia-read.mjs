/** Read-only public read-cost proof; never loads a signer or submits transactions. */
import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,http,encodeFunctionData,decodeAbiParameters,hexToBytes,keccak256} from 'viem';
const root='apps/desktop/artifacts/gator-sepolia';
const proof=JSON.parse(await readFile(`${root}/jpeg-live/proof.json`,'utf8'));
const build=JSON.parse(await readFile(`${root}/jpeg-token0-package/storage-test-sepolia-hold/solc-output.json`,'utf8'));
const abi=build.contracts['KeelJpegCopyReader.sol'].KeelJpegCopyReader.abi;
const rpc='https://ethereum-sepolia-rpc.publicnode.com';
const client=createPublicClient({transport:http(rpc,{timeout:30000,retryCount:1})});
assert.equal(await client.getChainId(),11155111);
const blockNumber=await client.getBlockNumber();
const shape=[{type:'uint16'},{type:'bytes'},{type:'tuple[]',components:[{name:'key',type:'string'},{name:'value',type:'string'}]}];
async function read(path){
 const parts=[],calls=[],seen=new Set();
 while(path){
  assert.ok(!seen.has(path.join('/')));seen.add(path.join('/'));assert.ok(seen.size<=100);
  const data=encodeFunctionData({abi,functionName:'request',args:[path,[]]});
  const response=await client.call({to:proof.renderer,data,gas:60_000_000n,blockNumber});
  const[status,body,headers]=decodeAbiParameters(shape,response.data);assert.equal(status,200);
  const bytes=Buffer.from(hexToBytes(body));parts.push(bytes);
  const gas=Number(await client.estimateGas({to:proof.renderer,data,gas:60_000_000n,blockNumber}));
  calls.push({path:path.join('/'),bytes:bytes.length,gas});
  const next=headers.find(h=>h.key.toLowerCase()==='web3-next-chunk')?.value;
  path=next?next.split('/').filter(Boolean):null;
 }
 return {bytes:Buffer.concat(parts),calls,aggregateGas:calls.reduce((sum,c)=>sum+c.gas,0)};
}
const metadata=await read(['tokenJSON','0']);
assert.equal(JSON.parse(metadata.bytes.toString()).image,proof.imageURI);
const image=await read(['image','0']);
assert.equal(keccak256(image.bytes),proof.jpegDigest);assert.ok(image.aggregateGas<60_000_000);
const result={schema:'gator-jpeg-sepolia-read-proof@1',chainId:11155111,rpc,blockNumber:String(blockNumber),renderer:proof.renderer,tokenId:0,imageBytes:image.bytes.length,imageDigest:keccak256(image.bytes),exactJPEGReadback:true,imageCalls:image.calls,aggregateImageGas:image.aggregateGas,metadataGas:metadata.aggregateGas,under60Million:true,excludes:'resolve-mode discovery and HTTP overhead',verifiedAt:new Date().toISOString()};
await writeFile(`${root}/jpeg-live/read-proof.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
