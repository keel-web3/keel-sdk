/** Small independent codec/authorization fixtures. No public RPC or wallet access. */
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,toHex,keccak256,hexToBytes} from 'viem';
const root='apps/desktop/artifacts/gator-raster-study/full-1080/jpeg-shared-huffman-q85-r2/substrings-24/overlap-packed/compact/storage-test-sepolia-hold';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const reader=(await json(`${root}/solc-output.json`)).contracts['KeelJpegCopyReader.sol'].KeelJpegCopyReader;
const holdBuild=await json('apps/desktop/artifacts/gator-sepolia/sepolia-hold-build.json');
const original=await json('apps/desktop/artifacts/gator-sepolia/compiled-original.json'),source=await json('apps/desktop/artifacts/gator-sepolia/mainnet-source.json');
const payload=Buffer.from('Exact byte copies across arbitrary boundaries, including zeros\0\0\0.');
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337'],{stdio:['ignore','pipe','pipe']});child.stderr.on('data',()=>{});
try {
 const url=await new Promise((resolve,reject)=>{let b='';const timer=setTimeout(()=>reject(Error('Local EVM timeout')),20000);child.once('error',reject);child.stdout.on('data',part=>{b=(b+part).slice(-4096);const m=b.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const client=createPublicClient({transport:http(url)}),wallet=createWalletClient({transport:http(url)});assert.equal(await client.getChainId(),31337);const[account,other]=await wallet.getAddresses();
 const receipt=async hash=>{const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;};
 const deploy=async(abi,bytecode,args=[])=> (await receipt(await wallet.deployContract({account,chain:null,abi,bytecode,args}))).contractAddress;
 const write=async(address,abi,functionName,args)=>receipt(await wallet.writeContract({account,chain:null,address,abi,functionName,args}));
 const hold=await deploy(holdBuild.abi,holdBuild.bytecode.object),collection=await deploy(original.abi,'0x'+original.evm.bytecode.object,source.decoded_constructor_args.map(([v,t])=>t.type.startsWith('uint')?BigInt(v):v));await write(collection,original.abi,'ownerMint',[1,account]);
 async function store(b){await write(hold,holdBuild.abi,'castSlugs',[[toHex(b)]]);const slug=keccak256(b),address=await client.readContract({address:hold,abi:holdBuild.abi,functionName:'slugPointer',args:[slug]});return{slug,address};}
 const data=await store(payload),map=await store(Buffer.from([0,0]));const envelope=Buffer.from('{"image":"'),meta=await store(Buffer.concat([Buffer.from([0,envelope.length]),envelope,Buffer.from('"}')]));
 const results=[];
 for(const pw of [1,2]){
  const ow=pw+4,codec=toHex(Buffer.from([75,74,67,49,pw,2,ow,16])),address=await deploy(reader.abi,'0x'+reader.evm.bytecode.object,[hold,collection,codec]);
  const ops=Buffer.alloc(ow*2);ops.writeUInt16BE(7,pw+2);ops.writeUInt16BE(7,ow+pw);ops.writeUInt16BE(payload.length-7,ow+pw+2);
  const instruction=await store(ops),table=await store(Buffer.from(hexToBytes(data.address))),instructionTable=await store(Buffer.from(hexToBytes(instruction.address))),range=await store(Buffer.from([0,0,0,0,0,ops.length]));
  const cases=[['registerDirectory',[0,[0n],[table.slug]]],['registerDirectory',[2,[0n],[instructionTable.slug]]],['registerDirectory',[3,[0n],[range.slug]]],['registerToken',[0n,[map.slug],1n,BigInt(payload.length)]],['registerMetadata',[0n,meta.slug]]];
  for(const[functionName,args]of cases){await client.simulateContract({address,abi:reader.abi,functionName,args,account});await assert.rejects(()=>client.simulateContract({address,abi:reader.abi,functionName,args,account:other}),e=>e.walk?.(e=>e.data?.errorName==='Unauthorized')?.data?.errorName==='Unauthorized');await write(address,reader.abi,functionName,args);}
  const[bytes,next]=await client.readContract({address,abi:reader.abi,functionName:'image',args:[0n,0n,1n]});assert.equal(bytes,toHex(payload));assert.equal(next,0n);
  const metadata=JSON.parse(await client.readContract({address,abi:reader.abi,functionName:'tokenJSON',args:[0n]}));assert.equal(metadata.image,`web3://${address.toLowerCase()}:31337/image/0`);
  // A registered instruction whose source slice exceeds the stored payload must fail.
  const bad=Buffer.from(ops);bad.writeUInt16BE(payload.length,pw);const malformed=await store(bad),badTable=await store(Buffer.from(hexToBytes(malformed.address)));await write(address,reader.abi,'registerDirectory',[2,[0n],[badTable.slug]]);
  await assert.rejects(()=>client.readContract({address,abi:reader.abi,functionName:'image',args:[0n,0n,1n]}),e=>e.walk?.(e=>e.data?.errorName==='Invalid')?.data?.errorName==='Invalid');
  results.push({pageWidth:pw,validOwnerRequestsPass:true,identicalOtherRequestsRevertUnauthorized:true,exactSplitCopies:true,metadataRoute:true,outOfBoundsSliceRejected:true});
 }
 await writeFile(`${root}/authorization-proof.json`,JSON.stringify({localOnly:true,results},null,2));console.log(JSON.stringify({localOnly:true,results}));
}finally{child.kill('SIGTERM');}
