/** Disposable Anvil only. Deploy the real verifier, govern, prove and read back. */
import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,createWalletClient,http,encodeFunctionData,keccak256,toHex,sha256,defineChain} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {decodeBitcoinProofValues} from '../../packages/protocol/dist/index.js';
import {submitBitcoinAttachment} from '../../packages/sdk/dist/bitcoin-proof.js';
const [receiptFile,outputFile,contractsRoot='/Users/ravonus/dev/keel-contracts',rpc='http://127.0.0.1:18547']=process.argv.slice(2);
if(!receiptFile||!outputFile) throw Error('Usage: node scripts/bridge/accept-bitcoin.mjs receipt.json output.json [contracts-root] [local-rpc]');
if(!['localhost','127.0.0.1'].includes(new URL(rpc).hostname)) throw Error('Disposable local RPC required');
const receipt=JSON.parse(fs.readFileSync(receiptFile));
const values=decodeBitcoinProofValues(receipt.publicValues);
const chain=defineChain({id:31337,name:'Bridge acceptance',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const account=privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const reader=createPublicClient({chain,transport:http(rpc)}),wallet=createWalletClient({chain,account,transport:http(rpc)});
if(await reader.getChainId()!==31337) throw Error('Expected disposable chain 31337');
const artifacts=new Map();
function artifact(name){if(!artifacts.has(name)) artifacts.set(name,JSON.parse(fs.readFileSync(path.join(contractsRoot,'out',(name==='SP1Verifier'?'SP1VerifierGroth16':name)+'.sol',name+'.json'))));return artifacts.get(name);}
const addresses={},transactions=[];
fs.mkdirSync(path.dirname(outputFile),{recursive:true});
function checkpoint(){fs.writeFileSync(outputFile+'.progress.json',JSON.stringify({rpc,addresses,transactions,programVKey:receipt.programVKey},(_,v)=>typeof v==='bigint'?v.toString():v,2));}
async function deploy(name,args=[],label=name){const a=artifact(name);const hash=await wallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args});const tx=await reader.waitForTransactionReceipt({hash});if(tx.status!=='success'||!tx.contractAddress)throw Error('Deployment failed '+name);addresses[label]=tx.contractAddress;transactions.push({action:'deploy '+label,hash,gasUsed:tx.gasUsed});checkpoint();return tx.contractAddress;}
async function read(name,address,fn,args=[]){return reader.readContract({address,abi:artifact(name).abi,functionName:fn,args});}
async function write(name,address,fn,args=[]){const simulation=await reader.simulateContract({address,abi:artifact(name).abi,functionName:fn,args,account});const hash=await wallet.writeContract(simulation.request);const tx=await reader.waitForTransactionReceipt({hash});if(tx.status!=='success')throw Error('Transaction failed '+fn);transactions.push({action:fn,hash,gasUsed:tx.gasUsed});checkpoint();return simulation.result;}
const zero=toHex(0n,{size:32}),zeroAddress='0x0000000000000000000000000000000000000000';
const governors=[1n,2n,3n].map(k=>privateKeyToAccount(toHex(k,{size:32}))).sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
const implementation=await deploy('KeelManager');
const initializer=encodeFunctionData({abi:artifact('KeelManager').abi,functionName:'initialize',args:[governors.map(g=>g.address),[account.address],[]]});
const manager=await deploy('KeelManagerProxy',[implementation,initializer]);
const store=await deploy('KeelHold',[manager,manager,[0n,0n,0n,10n,1n],0n]);
const objects=await deploy('KeelArtifactRegistry',[store,manager]);
const anchors=await deploy('KeelAttestedAnchorRegistry',[objects,account.address]);
const sp1=await deploy('SP1Verifier');
const backend=await deploy('KeelSp1GatewayProofBackend',[sp1,account.address]);
await write('KeelSp1GatewayProofBackend',backend,'configure',[receipt.programVKey]);
await write('KeelSp1GatewayProofBackend',backend,'lockConfiguration');
const adapter=await deploy('KeelZkAnchorVerifier',[anchors,account.address]);
await write('KeelZkAnchorVerifier',adapter,'setProofBackend',[backend]);
await write('KeelZkAnchorVerifier',adapter,'seedAnchorPoint',[values.originHash,values.originHeight,values.originBits,values.originTimestamp,values.originEpochStart]);
await write('KeelZkAnchorVerifier',adapter,'setFamilyPolicy',[3,6,BigInt(values.cumulativeWork)]);
const controller=await deploy('KeelProofUpgradeController',[manager]);
await write('KeelZkAnchorVerifier',adapter,'setProofProfile',[controller,keccak256(toHex('temporary'))]);
const configHash=await read('KeelZkAnchorVerifier',adapter,'configurationHash');
const manifest={schema:'keel.bitcoin.spv.profile.v3',route:'Bitcoin mainnet first-envelope -> EVM uncompressed',
 publicValuesBytes:281,programVKey:receipt.programVKey,elfSha256:receipt.elfSha256,sp1Version:receipt.sp1Version,
 bootstrap:{hash:values.originHash,height:values.originHeight,bits:values.originBits,timestamp:values.originTimestamp,epochStart:values.originEpochStart},
 policy:{confirmationFloor:6,minimumWork:values.cumulativeWork,maxTipAgeSeconds:86400,maxFutureSeconds:7200,selection:'greatest submitted work since bootstrap; first competing equal work wins',acceptance:'immediate SPV; no challenge interval',reorg:'immutable historical receipts; separate current source status'},
 dependencies:{...addresses,backendProgramKey:receipt.programVKey,verifierCodeHash:keccak256(await reader.getCode({address:sp1})),managerAuthority:'governed upgradeable proxy; quorum trust assumption'},
 adapterConfigHash:configHash,sourceSchema:await read('KeelZkAnchorVerifier',adapter,'bitcoinSourceSchema'),
 routeSpecificationSha256:sha256(toHex(fs.readFileSync(path.join(contractsRoot,'docs/BITCOIN_PROOF_ROUTE.md'))))};
const manifestText=JSON.stringify(manifest,null,2)+'\n';fs.writeFileSync(outputFile+'.manifest.json',manifestText);
const profile={family:3,network:4190024665,adapter,codeHash:keccak256(await reader.getCode({address:adapter})),manifestHash:keccak256(toHex(manifestText)),configHash};
const profileId=await read('KeelProofUpgradeController',controller,'profileId',[profile]);
await write('KeelZkAnchorVerifier',adapter,'setProofProfile',[controller,profileId]);
await write('KeelZkAnchorVerifier',adapter,'lockConfiguration');
await write('KeelProofUpgradeController',controller,'propose',[profile,'local://'+path.basename(outputFile)+'.manifest.json']);
async function govern(fn){const data=encodeFunctionData({abi:artifact('KeelProofUpgradeController').abi,functionName:fn,args:[profileId]});const action={target:controller,value:0n,data};const deadline=(await reader.getBlock()).timestamp+3600n;const digest=await read('KeelManager',manager,'governanceActionDigest',[action,deadline]);const signatures=await Promise.all(governors.slice(0,2).map(async g=>({signer:g.address,signature:await g.sign({hash:digest})})));await write('KeelManager',manager,'executeGovernance',[action,deadline,signatures]);}
await govern('approve');
const proposal=await read('KeelProofUpgradeController',controller,'proposal',[profileId]);
await reader.request({method:'evm_setNextBlockTimestamp',params:[Number(proposal.readyAt)]});await reader.request({method:'evm_mine'});
await write('KeelProofUpgradeController',controller,'activate',[profileId]);
await govern('suspend');if(await read('KeelProofUpgradeController',controller,'isAdmitted',[profileId,adapter,3,4190024665]))throw Error('Suspension failed');
await govern('approve');const resumption=await read('KeelProofUpgradeController',controller,'proposal',[profileId]);await reader.request({method:'evm_setNextBlockTimestamp',params:[Number(resumption.readyAt)]});await reader.request({method:'evm_mine'});await write('KeelProofUpgradeController',controller,'activate',[profileId]);
const verifierId=keccak256(toHex('bitcoin-local-acceptance-v3'));
await write('KeelAttestedAnchorRegistry',anchors,'registerVerifier',[verifierId,adapter,8,3,2,profile.manifestHash]);
const payload=toHex('{"p":"brc-20","op":"mint","tick":"tslau","amt":"1"}');
if(sha256(payload)!==values.anchorRoot)throw Error('Fixture payload mismatch');
const [slug]=await write('KeelHold',store,'castSlug',[payload]);
const content=await write('KeelHold',store,'weldObject',[[slug],sha256(payload),51n,0,'text/plain']);
const source={family:3,network:4190024665,registry:await read('KeelZkAnchorVerifier',adapter,'bitcoinSourceSchema'),objectKey:values.sourceTxid,revision:BigInt(values.sourceInput)+1n,eventDigest:values.blockHash};
const locator=await read('KeelZkAnchorVerifier',adapter,'bitcoinLocator',[values.sourceTxid,values.sourceInput]);
async function request(label){const objectId=await write('KeelArtifactRegistry',objects,'forgeArtifact',[keccak256(toHex(label)),{collection:zeroAddress,tokenId:0n},0,content,0,sha256(payload),keccak256(toHex(label+' metadata')),zero]);const anchorId=await write('KeelAttestedAnchorRegistry',anchors,'driveAnchor',[objectId,1n,source,verifierId,[locator],[]]);return {objectId,anchorId};}
const first=await request('local-real-proof');
async function mustReject(label,badValues,badProof){
 const data=encodeFunctionData({abi:artifact('KeelZkAnchorVerifier').abi,functionName:'submitZkAnchor',args:[first.anchorId,0,badValues,badProof]});
 const hash=await wallet.sendTransaction({to:adapter,data,gas:2_000_000n});
 const transaction=await reader.waitForTransactionReceipt({hash});
 if(transaction.status!=='reverted')throw Error(label+' unexpectedly accepted');
 const state=await read('KeelAttestedAnchorRegistry',anchors,'anchorState',[first.anchorId]);
 if(Number(state.status)!==1||await read('KeelZkAnchorVerifier',adapter,'bestChainWork')!==0n)throw Error(label+' changed pending state');
 return {label,rejected:true,transaction};
}
const corruptProof=receipt.proofBytes.slice(0,-2)+(parseInt(receipt.proofBytes.slice(-2),16)^1).toString(16).padStart(2,'0');
const rejections=[await mustReject('corrupt proof',values,corruptProof),await mustReject('corrupt public values',{...values,maxTimestamp:values.maxTimestamp+1},receipt.proofBytes)];
const accepted=await submitBitcoinAttachment({publicClient:reader,walletClient:wallet,expectedChainId:31337,account:account.address,adapter,anchorId:first.anchorId,expectedProfileId:profileId,values,proof:receipt.proofBytes,sourcePath:receipt.sourceBlockPath});
if(accepted.readback.anchor.objectId!==first.objectId||BigInt(accepted.readback.anchor.artifactRevision)!==1n) throw Error('Wrong exact object/revision');
const browserRequest=await request('local-browser-proof');
const result={route:'Bitcoin mainnet SPV first envelope -> EVM, uncompressed',snapshotOnly:true,rpc,chainId:31337,addresses,profileId,profile,first,accepted,rejections,browserRequest,transactions,verifierCodeHash:keccak256(await reader.getCode({address:sp1}))};
fs.writeFileSync(outputFile,JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');console.log('Acceptance saved:',outputFile);
