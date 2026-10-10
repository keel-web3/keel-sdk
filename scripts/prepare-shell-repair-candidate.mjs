import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_KEEL_VERIFICATION_PRESENTATION } from '../packages/protocol/dist/index.js';
import { buildKeelInlineShellFragments, buildKeelInlineLocalDocument, buildKeelInlinePreEncodedTokenURIGraph, buildKeelInlineRawPercentTokenURIGraph, decodeKeelInlineGraphFragment } from '../packages/sdk/dist/inline-viewer-graph.js';
import { createKeelShellManifest, KEEL_INLINE_PROTECTION_SHELL_ID } from '../packages/sdk/dist/shell-registry.js';
import { createKeelNativeObjectPlan } from '../packages/sdk/dist/native-publication.js';
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256, concatHex, stringToHex, toHex } from 'viem';

// Offline preparation only. No provider, signer, environment credentials or RPC.
const output = resolve(process.argv[2] ?? '/tmp/keel-shell-repair-candidate');
const chainId = 11155111, store = '0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267', builder = '0x63a172ae55a6c7413a2f80be9de9cd9cb106973d';
const keeper = '0x404A6bd65EF48AE85Da7b0E9358715a34A401b05';
const sha = bytes => '0x'+createHash('sha256').update(bytes).digest('hex');
const abi = parseAbi(['function castSlugs(bytes[] payloads) returns(bytes32[])', 'function weldObject(bytes32[] slugIds,bytes32 digest,uint64 byteLength,uint8 compression,string mediaType) returns(bytes32)', 'function setShell(bytes32 shellId,bytes32 prefix,bytes32 suffix,uint8 payloadMode,bytes32 metadataObjectId)']);
await mkdir(output,{recursive:true});
const shell = await buildKeelInlineShellFragments();
const authored = new TextDecoder('utf-8',{fatal:true}).decode(shell.suffix.bytes);
const presentation = JSON.stringify(DEFAULT_KEEL_VERIFICATION_PRESENTATION);
const singleQuoted = "'"+presentation.replaceAll('\\', '\\\\').replaceAll("'", "\\'")+"'";
if (DEFAULT_KEEL_VERIFICATION_PRESENTATION.revision !== 3 || !(authored.includes(singleQuoted) || authored.includes(JSON.stringify(presentation)))) throw new Error('Candidate lacks exact authored presentation revision 3.');
const root = await buildKeelInlineLocalDocument({ shell, modules: [], entry: { id:'repair-byte-fixture.js', mediaType:'text/javascript', source:new TextEncoder().encode('globalThis.__KEEL_SHELL_REPAIR_BYTE_FIXTURE__=true;') } });
// The registered legacy infrastructure requires its existing Base64 fragment
// format. This acknowledgement is only for that canonical registry pair; no
// creator artwork is converted or republished by this script.
const registered = await buildKeelInlinePreEncodedTokenURIGraph(root,{legacyCarriage:'acknowledged'});
const compact = await buildKeelInlineRawPercentTokenURIGraph(root);
const manifest = await createKeelShellManifest({name:'KEEL verification shell',description:'Canonical verification shell with authored presentation revision 3. Prepared for keeper review; registration requires exact selected-chain verification.',version:'1.2.0',creator:keeper,tags:['default','inline','verification','protected','sandbox']});
const objects = [];
async function object(name, bytes, mediaType) {
  const file = name+'.bin'; await writeFile(resolve(output,file),bytes);
  // Match the maintained legacy bootstrap's conservative carrier size. These
  // are proposals, not claims about today's onchain limits or missing slugs.
  const plan = await createKeelNativeObjectPlan(bytes,{objectName:name,mediaType,keccak256,maxChunkBytes:23000,maxBatchSlugs:1});
  const id = keccak256(encodeAbiParameters([{type:'bytes1'},{type:'bytes32'},{type:'bytes32'},{type:'uint64'},{type:'uint64'},{type:'uint8'},{type:'bytes32'}],['0x00',keccak256(concatHex(plan.slugIds)),plan.digest,BigInt(bytes.length),BigInt(bytes.length),0,keccak256(stringToHex(mediaType))]));
  const weld = {to:store,value:'0x0',data:encodeFunctionData({abi,functionName:'weldObject',args:[plan.slugIds,plan.digest,BigInt(bytes.length),0,mediaType]})};
  const result = {name,file,objectId:id,digest:sha(bytes),byteLength:bytes.length,storedByteLength:bytes.length,compression:'none',mediaType,chunkBytes:23000,slugIds:plan.slugIds,
    candidateUploads:plan.carrierBatches.map(parts=>({to:store,value:'0x0',data:encodeFunctionData({abi,functionName:'castSlugs',args:[parts.map(part=>toHex(part))]})})),weld,
    reuse:'unverified: check object and each slug before any funding or upload',publicationFee:'unquoted',simulation:'not-performed'};
  objects.push(result); return result;
}
const sides = {};
for(const [lane,graph] of [['registered',registered],['compact',compact]]) for(const side of ['prefix','suffix']) {
  const part=graph.parts.find(p=>p.role==='shell-'+side); if(!part)throw new Error('Missing shell fragment');
  const decoded=decodeKeelInlineGraphFragment(part.bytes,graph.mediaType);
  const canonical=new TextDecoder().decode(shell[side].bytes).replace(/ {0,8}$/u,'');
  if(new TextDecoder().decode(decoded).replace(/ {0,8}$/u,'')!==canonical)throw new Error('Candidate carriage does not preserve the exact shell');
  const item=await object(lane+'-'+side,part.bytes,graph.mediaType);item.decodedSha256=sha(new TextEncoder().encode(canonical));item.decodedBytes=new TextEncoder().encode(canonical).length;
  sides[lane+'-'+side]=item;
}
const metadata=await object('shell-metadata',manifest.bytes,'application/json');
const registration={chainId,from:keeper,to:builder,value:'0x0',data:encodeFunctionData({abi,functionName:'setShell',args:[KEEL_INLINE_PROTECTION_SHELL_ID,sides['registered-prefix'].objectId,sides['registered-suffix'].objectId,2,metadata.objectId]})};
const fragment = ({objectId,digest,byteLength,storedByteLength,mediaType}) => ({objectId,digest,byteLength,storedByteLength,mediaType});
const report={schema:'keel-canonical-shell-repair-candidate@1',status:'unsigned-unverified-onchain',chainId,store,builder,keeper,shellId:KEEL_INLINE_PROTECTION_SHELL_ID,authoredPresentationRevision:3,observedRegistryRevision:5,sourceSdkCommit:'d4c5b2add21c1340f8782bcf286f4268afb12b9f',sourceEvidence:'libfile_696d74f5c3fc8191bc86542d38681e76',objects,registration,
  cataloguePatch:{shell:{shellId:KEEL_INLINE_PROTECTION_SHELL_ID,metadataObjectId:metadata.objectId,prefix:fragment(sides['registered-prefix']),suffix:fragment(sides['registered-suffix'])},compact:{shell:{prefix:fragment(sides['compact-prefix']),suffix:fragment(sides['compact-suffix'])}}},
  requiredBeforeApproval:['Re-read chain identity, canonical block, keeper, builder/store runtime and registry revision; reject changes.', 'Read selected Hold limits, fees, systems-active and exact existing object/slug bytes. Reuse existing verified bytes and preserve all old objects. Never blindly submit candidateUploads.', 'Quote and simulate each missing storage operation at exact current chain transaction capacity, retaining the same journal on unknown/pending results.', 'Verify uploaded object receipts and full bytes, then simulate this exact setShell from the actual keeper. The prior 540577-gas estimate used OLD commitments and is not this repair quote.', 'Request precise keeper approval for this registration and separate owner approval for any storage payment; no approval is implied by this artifact.'],
  requiredAfterRegistration:['Verify canonical keeper transaction receipt, incremented shell revision, exact prefix/suffix/metadata commitments and full bytes.', 'Update only verified shell fields in the existing catalogue; retain all modules, compact builder identity and deployment receipt.', 'Re-run Studio fresh readiness, complete tokenURI/offline browser byte checks and the original owned fixture.'],
  historicalObjectsChanged:false,creatorStorageChanged:false,transactionsSubmitted:0,signaturesProduced:0,publicationVerified:false};
await writeFile(resolve(output,'candidate.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,registration,objects:objects.map(({name,objectId,digest,byteLength,decodedSha256})=>({name,objectId,digest,byteLength,decodedSha256})),status:report.status},null,2));
