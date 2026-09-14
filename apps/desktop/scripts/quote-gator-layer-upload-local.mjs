/** Local EVM estimate. No layer bytes are sent to a public RPC. */
import {spawn} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,encodeFunctionData,formatEther} from 'viem';
const root='apps/desktop/artifacts/gator-inline-sepolia/3750-objects';
const hold=JSON.parse(await readFile('apps/desktop/artifacts/gator-sepolia/sepolia-hold-build.json','utf8'));
const live=JSON.parse(await readFile('apps/desktop/artifacts/gator-inline-sepolia/live-check.json','utf8'));
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337','--gas-limit','60000000'],{stdio:['ignore','pipe','pipe']});
try {
 const url=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Local EVM timeout')),15000);child.once('error',reject);child.stdout.on('data',b=>{data+=b;const m=data.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const c=createPublicClient({transport:http(url)}),w=createWalletClient({transport:http(url)}),[account]=await w.getAddresses();if(await c.getChainId()!==31337)throw Error('Not local chain');
 const address=(await c.waitForTransactionReceipt({hash:await w.deployContract({account,chain:null,abi:hold.abi,bytecode:hold.bytecode.object})})).contractAddress;
 const rows=[];for(const f of await readdir(root+'/chunks')){const bytes=await readFile(root+'/chunks/'+f);const gas=await c.estimateGas({account,to:address,data:encodeFunctionData({abi:hold.abi,functionName:'castSlugs',args:[['0x'+bytes.toString('hex')]]})});rows.push({id:'0x'+f,bytes:bytes.length,gas:String(gas)});}
 const gas=rows.reduce((s,r)=>s+BigInt(r.gas),0n),fee=BigInt(live.maxFeePerGas),cost=gas*fee;
 const report={schema:'gator-local-storage-quote@1',localEVM:true,publicCalldataSent:false,targetChain:11155111,feeBlock:live.block,feeCheckedAt:live.checkedAt,rows,assumption:'All chunks new; existing-byte reuse not yet checked',chunkUploadGas:String(gas),chunkUploadMaxCostETH:formatEther(cost),balanceETH:live.balanceETH,excludes:['object registration','shared module and shell revision binding','metadata adapter deployment','collection update'],published:false};
 await writeFile(root+'/local-storage-quote.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined}));
} finally {child.kill('SIGTERM');}
