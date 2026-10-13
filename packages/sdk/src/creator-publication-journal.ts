import { createHash } from "node:crypto";
import { decodeEventLog, encodeFunctionData, getAddress, keccak256, parseAbi, type Hex } from "viem";
import { buildKeelCreatorPreparedCopyBindingCall } from "./creator-prepared-inline.js";
import type { prepareKeelAuthenticatedCreatorInline } from "./creator-prepared-route.js";
import { simulateKeelPublicationBeforeFunding, type KeelPublicationSimulationInput, type KeelPreflightTransport, type KeelSimulationCall } from "./publication-preflight.js";

type Prepared = Awaited<ReturnType<typeof prepareKeelAuthenticatedCreatorInline>>;
type Phase = "upload" | "validate" | "create-collection" | "bind" | "mint-route" | "mint";
export interface KeelCreatorPublicationStep { readonly id: string; readonly phase: Phase; readonly call: KeelSimulationCall }
export interface KeelCreatorPublicationReceipt { readonly stepId: string; readonly transactionHash: Hex; readonly blockHash: Hex; readonly blockNumber: Hex }
export interface KeelCreatorPublicationJournal {
  readonly schema: "keel.creator-prepared-publication-journal@1";
  readonly id: string; readonly actorId: string; readonly owner: Hex; readonly sourceRevision: string; readonly settingsRevision: string;
  readonly fingerprint: Hex; readonly chainId: number; readonly collection: Hex; readonly tokenId: string;
  readonly route: Prepared["route"]; readonly runtime: readonly { readonly address: Hex; readonly codeHash: Hex }[];
  readonly steps: readonly KeelCreatorPublicationStep[];
  readonly receipts: readonly KeelCreatorPublicationReceipt[];
  readonly walletAttempt?: { readonly id: string; readonly stepId: string; readonly createdAt: string };
  readonly simulation: Omit<KeelPublicationSimulationInput, "planFingerprint" | "preparationCalls" | "blockNumber">;
}
const identity = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
const digest = (value: unknown): Hex => `0x${createHash("sha256").update(identity(value)).digest("hex")}`;
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Missing selected-chain receipt evidence.");
  return value as Record<string, unknown>;
};
const TOKEN = parseAbi(["function tokenURI(uint256) view returns(string)"]);
const CREATED = parseAbi(["event CreatorCollectionRegistered(bool mintCompatible,uint8 standard,uint8 deployment,string name,uint256 indexed collectionId,address indexed creator,address indexed tokenContract,uint128 sharedCollectionId,bytes32 metadataDigest)"]);

/** Private server journal, never a wallet response. The compiler supplies exact
 * canonical upload/factory/bind/mint calls; this snapshot cannot authorize them.
 * Fresh publications only: no existing collection or paid artifact is migrated. */
export function createKeelCreatorPublicationJournal(input: {
  readonly id: string; readonly actorId: string; readonly owner: Hex; readonly sourceRevision: string; readonly settingsRevision: string;
  readonly prepared: Prepared; readonly collection: Hex; readonly tokenId: bigint;
  readonly steps: readonly KeelCreatorPublicationStep[];
  readonly simulation: Omit<KeelPublicationSimulationInput, "chainId" | "planFingerprint" | "preparationCalls" | "reader" | "readerRuntimeCodeHash" | "metadataTarget" | "blockNumber">;
}): KeelCreatorPublicationJournal {
  if (![input.id,input.actorId,input.sourceRevision,input.settingsRevision].every(value=>typeof value==="string" && value.length>0 && value.length<=256)) throw new TypeError("An authenticated actor and exact source/settings revisions are required.");
  const owner=getAddress(input.owner),collection=getAddress(input.collection);
  if (!input.steps.length || input.steps.length>255 || input.tokenId<=0n || input.prepared.prepaymentSimulation!=="required") throw new TypeError("Invalid fresh prepared publication plan.");
  const phases: readonly Phase[]=["upload","validate","create-collection","bind","mint-route","mint"];
  const ids=new Set<string>();let prior=-1;
  for(const step of input.steps){
    const at=phases.indexOf(step.phase);
    if(at<prior || at<0 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(step.id) || ids.has(step.id) || !same(step.call.from,owner))throw new TypeError("Publication steps must be ordered, unique, and owned by the authenticated creator.");
    ids.add(step.id);prior=at;
  }
  for(const phase of ["create-collection","bind","mint"] as const)if(input.steps.filter(step=>step.phase===phase).length!==1)throw new TypeError(`Fresh publication requires one exact ${phase} step.`);
  if(!input.steps.some(step=>step.phase==="mint-route"))throw new TypeError("Fresh publication requires exact mint-route setup steps.");
  const create=input.steps.find(step=>step.phase==="create-collection")!;
  if(!same(create.call.to,input.prepared.route.factory))throw new TypeError("Collection creation targets another factory.");
  const bind=input.steps.find(step=>step.phase==="bind")!;
  const expected=buildKeelCreatorPreparedCopyBindingCall({renderer:input.prepared.route.renderer,collection,tokenId:input.tokenId,plan:input.prepared});
  if(!same(bind.call.to,expected.to)||bind.call.data!==expected.data||BigInt(bind.call.value)!==0n)throw new TypeError("Prepared binding does not match every reviewed carrier and table commitment.");
  if(!same(input.simulation.metadataCall.to,collection)||input.simulation.metadataCall.data!==encodeFunctionData({abi:TOKEN,functionName:"tokenURI",args:[input.tokenId]}))throw new TypeError("Publication must observe the exact final collection tokenURI.");
  if(input.simulation.observationCalls?.length)throw new TypeError("Mint belongs in the validated publication plan, not an unvalidated observation shortcut.");
  const runtime=input.prepared.infrastructure.contracts.map(item=>{
    if(!item.runtimeCodeHash)throw new TypeError("Missing authenticated runtime commitment.");
    return {address:item.address,codeHash:item.runtimeCodeHash};
  });
  const renderer=runtime.find(item=>same(item.address,input.prepared.route.renderer));
  if(!renderer)throw new TypeError("Prepared renderer is not authenticated.");
  const snapshot={schema:"keel.creator-prepared-publication-journal@1" as const,id:input.id,actorId:input.actorId,owner,
    sourceRevision:input.sourceRevision,settingsRevision:input.settingsRevision,chainId:input.prepared.chainId,collection,tokenId:input.tokenId.toString(),route:input.prepared.route,runtime,
    steps:structuredClone(input.steps),simulation:{...structuredClone(input.simulation),chainId:input.prepared.chainId,reader:input.prepared.route.renderer,readerRuntimeCodeHash:renderer.codeHash,metadataTarget:collection}};
  return {...snapshot,fingerprint:digest(snapshot),receipts:[]};
}

function assertJournal(journal:KeelCreatorPublicationJournal){
  const {fingerprint,receipts,walletAttempt,...snapshot}=journal;
  if(journal.schema!=="keel.creator-prepared-publication-journal@1"||digest(snapshot)!==fingerprint||receipts.length>journal.steps.length)throw new TypeError("Prepared publication journal identity changed.");
  receipts.forEach((receipt,index)=>{if(receipt.stepId!==journal.steps[index]?.id)throw new TypeError("Publication receipts are not an ordered completed prefix.");});
  if(walletAttempt && (walletAttempt.stepId!==journal.steps[receipts.length]?.id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(walletAttempt.id) || !Number.isFinite(Date.parse(walletAttempt.createdAt))))throw new TypeError("Invalid pending publication wallet attempt.");
}
async function verifyReceipt(journal:KeelCreatorPublicationJournal,step:KeelCreatorPublicationStep,transactionHash:Hex,transport:KeelPreflightTransport){
  const [rawTx,rawReceipt]=await Promise.all([transport.request({method:"eth_getTransactionByHash",params:[transactionHash]}),transport.request({method:"eth_getTransactionReceipt",params:[transactionHash]})]);
  const tx=record(rawTx),receipt=record(rawReceipt);
  if(receipt.status!=="0x1"||!same(receipt.transactionHash,transactionHash)||!same(tx.hash,transactionHash)||!same(tx.from,step.call.from)||!same(tx.to,step.call.to)||!same(tx.input,step.call.data)||typeof tx.value!=="string"||BigInt(tx.value)!==BigInt(step.call.value)
    ||typeof receipt.blockHash!=="string"||!/^0x[0-9a-f]{64}$/iu.test(receipt.blockHash)||typeof receipt.blockNumber!=="string"||!/^0x[0-9a-f]+$/iu.test(receipt.blockNumber))throw new TypeError("The receipt does not prove the exact reviewed publication step.");
  if(step.phase==="create-collection"){
    const matches=Array.isArray(receipt.logs)?receipt.logs.filter(value=>{
      const log=record(value);if(!same(log.address,journal.route.factory)||typeof log.data!=="string"||!Array.isArray(log.topics))return false;
      try{const event=decodeEventLog({abi:CREATED,eventName:"CreatorCollectionRegistered",data:log.data as Hex,topics:log.topics as [Hex,...Hex[]]});
        return same(event.args.creator,journal.owner)&&same(event.args.tokenContract,journal.collection)&&event.args.mintCompatible===true&&event.args.deployment===0;
      }catch{return false;}
    }):[];
    if(matches.length!==1)throw new TypeError("Factory receipt does not identify the exact predicted creator collection.");
  }
  const block=record(await transport.request({method:"eth_getBlockByNumber",params:[receipt.blockNumber,false]}));
  if(!same(block.hash,receipt.blockHash))throw new TypeError("Publication receipt was reorganized.");
  return {stepId:step.id,transactionHash,blockHash:receipt.blockHash as Hex,blockNumber:receipt.blockNumber as Hex};
}
export async function recordKeelCreatorPublicationReceipt(journal:KeelCreatorPublicationJournal,transactionHash:Hex,transport:KeelPreflightTransport){
  assertJournal(journal);
  if(BigInt(String(await transport.request({method:"eth_chainId",params:[]})))!==BigInt(journal.chainId))throw new TypeError("Wrong publication receipt chain.");
  const existing=journal.receipts.find(receipt=>same(receipt.transactionHash,transactionHash));
  if(existing){await verifyReceipt(journal,journal.steps[journal.receipts.indexOf(existing)]!,transactionHash,transport);return journal;}
  const step=journal.steps[journal.receipts.length];if(!step)throw new TypeError("Publication already has every successful receipt.");
  const receipt=await verifyReceipt(journal,step,transactionHash,transport);
  const {walletAttempt:_attempt,...base}=journal;
  return {...base,receipts:[...journal.receipts,receipt]};
}

/** Always replay remaining calls before returning ONE payable request. Previously
 * confirmed calls are verified and omitted, never repeated on resume. */
export async function prepareKeelCreatorPublicationWalletStep(journal:KeelCreatorPublicationJournal,input:{
  readonly actorId:string;readonly owner:Hex;readonly sourceRevision:string;readonly settingsRevision:string;
},transport:KeelPreflightTransport){
  assertJournal(journal);
  if(input.actorId!==journal.actorId||!same(input.owner,journal.owner)||input.sourceRevision!==journal.sourceRevision||input.settingsRevision!==journal.settingsRevision)throw new TypeError("Publication actor, source or build settings changed. Reconcile before any new payment.");
  if(journal.walletAttempt)return {status:"wallet-attempt-pending" as const,approval:null,attempt:journal.walletAttempt};
  if(BigInt(String(await transport.request({method:"eth_chainId",params:[]})))!==BigInt(journal.chainId))throw new TypeError("Wrong publication chain.");
  for(const [i,receipt]of journal.receipts.entries())await verifyReceipt(journal,journal.steps[i]!,receipt.transactionHash,transport);
  const pending=journal.steps.slice(journal.receipts.length);
  if(!pending.length)return {status:"receipts-complete" as const,approval:null,requiredGate:"final-public-tokenURI-readback" as const};
  const block=record(await transport.request({method:"eth_getBlockByNumber",params:["latest",false]}));
  if(typeof block.number!=="string"||!/^0x[0-9a-f]+$/iu.test(block.number))throw new TypeError("Missing current publication block.");
  if(!journal.receipts.some(receipt=>journal.steps.find(step=>step.id===receipt.stepId)?.phase==="create-collection")){
    const existing=await transport.request({method:"eth_getCode",params:[journal.collection,block.number]});
    if(existing!=="0x")throw new TypeError("Fresh prepared publication cannot replace an existing collection.");
  }
  for(const contract of journal.runtime){
    const code=await transport.request({method:"eth_getCode",params:[contract.address,block.number]});
    if(typeof code!=="string"||!/^0x(?:[0-9a-f]{2})+$/iu.test(code)||keccak256(code as Hex)!==contract.codeHash)throw new TypeError("Prepared publication runtime changed.");
  }
  const proof=await simulateKeelPublicationBeforeFunding({...journal.simulation,assertions:(journal.simulation.assertions ?? []).filter(a=>a.callIndex>=journal.receipts.length).map(a=>({...a,callIndex:a.callIndex-journal.receipts.length})),blockNumber:BigInt(block.number),planFingerprint:journal.fingerprint,preparationCalls:pending.map(step=>step.call)},transport);
  const gas=proof.transactionGasLimits[0];if(!gas)throw new TypeError("Missing exact next-step gas envelope.");
  const step=pending[0]!;
  return {status:"approval-required" as const,stepId:step.id,phase:step.phase,approval:{...step.call,gas:`0x${BigInt(gas).toString(16)}` as Hex},proof,sourceRevision:journal.sourceRevision,settingsRevision:journal.settingsRevision,signing:"not-performed" as const,submission:"not-performed" as const};
}

export function serializeKeelCreatorPublicationJournal(journal:KeelCreatorPublicationJournal):string{
  assertJournal(journal);return identity(journal);
}
export function parseKeelCreatorPublicationJournal(text:string):KeelCreatorPublicationJournal{
  if(typeof text!=="string"||text.length>32*1024*1024)throw new TypeError("Invalid prepared publication journal size.");
  const value=JSON.parse(text) as KeelCreatorPublicationJournal;
  const number=(input:unknown)=>{if(typeof input!=="string"||! /^(?:0|[1-9][0-9]{0,77})$/u.test(input))throw new TypeError("Invalid journal integer.");return BigInt(input);};
  const journal={...value,route:{...value.route,shellRevision:number(value.route.shellRevision)},simulation:{...value.simulation,
    maximumReadGas:number(value.simulation.maximumReadGas),collectionOverheadGas:number(value.simulation.collectionOverheadGas),maximumTransactionGas:number(value.simulation.maximumTransactionGas),
    ...(value.simulation.requiredReaderCalls===undefined?{}:{requiredReaderCalls:value.simulation.requiredReaderCalls.map(check=>({...check,gasMargin:number(check.gasMargin)}))})}};
  assertJournal(journal);return journal;
}


/** Persist this slot atomically before delivering a wallet request. Unknown
 * wallet outcomes remain pending until an exact receipt or explicit rejection. */
export function beginKeelCreatorPublicationWalletAttempt(journal:KeelCreatorPublicationJournal,id:string,now:number){
  assertJournal(journal);if(journal.walletAttempt)throw new TypeError("A publication wallet attempt is already pending.");
  const step=journal.steps[journal.receipts.length];
  if(!step||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)||!Number.isFinite(now))throw new TypeError("Invalid wallet attempt.");
  return {...journal,walletAttempt:{id,stepId:step.id,createdAt:new Date(now).toISOString()}};
}
export function rejectKeelCreatorPublicationWalletAttempt(journal:KeelCreatorPublicationJournal,input:{readonly id:string;readonly result:"rejected-before-submission"}){
  assertJournal(journal);if(input.result!=="rejected-before-submission"||journal.walletAttempt?.id!==input.id)throw new TypeError("An unknown or submitted wallet attempt must be reconciled using its receipt.");
  const {walletAttempt:_attempt,...next}=journal;return next;
}
