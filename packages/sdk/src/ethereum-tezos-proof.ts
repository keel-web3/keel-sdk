/** Candidate Ethereum runtime-code range → Tezos KEEL route; no production deployment implied. */
import { keccak256, sha256, type Hex } from 'viem';
import type { TezosMichelineValue, TezosTransactionOperation } from './tezos-publication.js';
export interface EthereumTezosCoordinates {
  network: 1; schema: 1; slot: bigint; account: Hex; codeHash: Hex;
  offset: bigint; length: bigint; objectId: Hex; revision: bigint;
}
function bytes(value: string, length?: number): string {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || (length !== undefined && value.length !== 2 + length * 2)) throw new Error('Invalid proof bytes');
  return value.slice(2).toLowerCase();
}
function natural(n: bigint): TezosMichelineValue {
  if (typeof n !== 'bigint' || n < 0n || n >= 1n << 64n) throw new Error('Coordinate is outside uint64');
  return {int:n.toString()};
}
function pair(values: TezosMichelineValue[]): TezosMichelineValue {
  if (values.length < 2) throw new Error('Pair requires two values');
  return {prim:'Pair',args:[values[0]!,values.length===2 ? values[1]! : pair(values.slice(1))]};
}
export function encodeEthereumTezosCoordinates(c: EthereumTezosCoordinates): TezosMichelineValue {
  if (c.network !== 1 || c.schema !== 1 || c.length === 0n || c.revision === 0n) throw new Error('Unsupported route or empty content');
  return pair([{bytes:bytes(c.account,20)},{bytes:bytes(c.codeHash,32)},natural(c.length),{int:'1'},
    {bytes:bytes(c.objectId,32)},natural(c.offset),natural(c.revision),{int:'1'},natural(c.slot)]);
}
function binary(node: TezosMichelineValue): string {
  if (Array.isArray(node)) throw new Error('Unexpected coordinate list');
  const n = node as {bytes?:string;int?:string;prim?:string;args?:TezosMichelineValue[]};
  if (n.bytes !== undefined) return '0a'+(n.bytes.length/2).toString(16).padStart(8,'0')+n.bytes;
  if (n.int !== undefined) {
    let x=BigInt(n.int);let first=Number(x&63n);x>>=6n;
    let result=(first|(x ? 128:0)).toString(16).padStart(2,'0');
    while(x){const next=Number(x&127n);x>>=7n;result+=(next|(x ? 128:0)).toString(16).padStart(2,'0');}
    return '00'+result;
  }
  if(n.prim==='Pair'&&n.args?.length===2)return '0707'+binary(n.args[0]!)+binary(n.args[1]!);
  throw new Error('Unsupported coordinate encoding');
}
/** Contract-scoped lookup ID. Portable identity also requires destination chain and receiver. */
export function ethereumTezosAttachmentId(c: EthereumTezosCoordinates): Hex {
  return sha256(`0x05${binary(encodeEthereumTezosCoordinates(c))}`);
}
export function buildEthereumTezosAttachment(input: {
  receiver:string; coordinates:EthereumTezosCoordinates; code:Hex; accountRlp:Hex; accountProof:readonly Hex[];
}): TezosTransactionOperation {
  if (!/^KT1[1-9A-HJ-NP-Za-km-z]{33}$/.test(input.receiver)) throw new Error('Invalid receiving contract');
  const c=input.coordinates;const encoded=encodeEthereumTezosCoordinates(c);const code=bytes(input.code);
  if (keccak256(input.code).toLowerCase()!==c.codeHash.toLowerCase()) throw new Error('Code hash mismatch');
  if (c.offset+c.length>BigInt(code.length/2)) throw new Error('Incomplete source range');
  if(input.accountProof.length===0||input.accountProof.length>65)throw new Error('Invalid account proof coverage');
  return {kind:'transaction',amount:'0',destination:input.receiver,parameters:{entrypoint:'attach',value:pair([
    {bytes:bytes(input.accountRlp)},{bytes:code},encoded,input.accountProof.map(p=>({bytes:bytes(p)}))])}};
}
export async function readEthereumTezosAttachment(input: {
  rpc:string; expectedChainId:string; receiver:string; identity:Hex; expectedProfile:Hex; blockHash?:string; fetcher?:typeof fetch;
}) {
  const fetcher=input.fetcher??fetch;const base=input.rpc.replace(/\/$/,'');
  if(!/^https?:\/\//.test(base)||!/^KT1[1-9A-HJ-NP-Za-km-z]{33}$/.test(input.receiver))throw new Error('Invalid chain endpoint or receiver');
  bytes(input.identity,32);bytes(input.expectedProfile,32);
  async function request(path:string,body?:unknown):Promise<any>{
    const response=await fetcher(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw new Error(`Tezos RPC unavailable (${response.status})`);return response.json();
  }
  const chainId=await request('/chains/main/chain_id');
  if(chainId!==input.expectedChainId)throw new Error('Wrong Tezos network');
  const blockHash=input.blockHash??await request('/chains/main/blocks/head/hash');
  if(typeof blockHash!=='string'||!/^B[1-9A-HJ-NP-Za-km-z]{50}$/.test(blockHash))throw new Error('Invalid Tezos block hash');
  const result=await request(`/chains/main/blocks/${blockHash}/helpers/scripts/run_script_view`,{
    contract:input.receiver,view:'attachment',input:{bytes:bytes(input.identity,32)},chain_id:chainId,unparsing_mode:'Readable'});
  const flatten=(n:any):any[]=>n?.prim==='Pair'&&Array.isArray(n.args)?n.args.flatMap(flatten):[n];
  const fields=flatten(result.data);
  if(fields.length!==14||`0x${fields[11]?.bytes}`.toLowerCase()!==input.expectedProfile.toLowerCase())throw new Error('Receipt schema or pinned profile mismatch');
  const coordinates:EthereumTezosCoordinates={account:`0x${fields[1].bytes}`,codeHash:`0x${fields[2].bytes}`,length:BigInt(fields[3].int),network:Number(fields[4].int) as 1,objectId:`0x${fields[5].bytes}`,offset:BigInt(fields[6].int),revision:BigInt(fields[7].int),schema:Number(fields[8].int) as 1,slot:BigInt(fields[9].int)};
  if(ethereumTezosAttachmentId(coordinates)!==input.identity.toLowerCase())throw new Error('Receipt coordinates mismatch');
  let currentSourceStatus:'finalized'|'client-stale'|'unknown'|'unavailable'='unavailable';
  try {
    const status=await request(`/chains/main/blocks/${blockHash}/helpers/scripts/run_script_view`,{
      contract:input.receiver,view:'source_status',input:{bytes:bytes(input.identity,32)},chain_id:chainId,unparsing_mode:'Readable'});
    if(!['0','1','2'].includes(status.data?.int))throw new Error('Unknown source status');
    currentSourceStatus=status.data.int==='1'?'finalized':status.data.int==='2'?'client-stale':'unknown';
  } catch { currentSourceStatus='unavailable'; }
  const profileStates=['proposed','review-delay','active','suspended','cancelled','expired','unknown','immutable'] as const;
  let currentProfileStatus:typeof profileStates[number]|'unavailable'='unavailable';
  try {
    const status=await request(`/chains/main/blocks/${blockHash}/helpers/scripts/run_script_view`,{
      contract:input.receiver,view:'profile_status',input:{prim:'Unit'},chain_id:chainId,unparsing_mode:'Readable'});
    if(!/^[0-7]$/.test(status.data?.int??''))throw new Error('Unknown profile status');
    currentProfileStatus=profileStates[Number(status.data.int)]!;
  } catch { currentProfileStatus='unavailable'; }
  return {chainId,blockHash,receiver:input.receiver,recordedAcceptance:true,coordinates,
    digest:`0x${bytes(`0x${fields[10].bytes}`,32)}` as Hex,profile:input.expectedProfile,
    stateRoot:`0x${bytes(`0x${fields[12].bytes}`,32)}` as Hex,acceptedAt:fields[0].string??fields[0].int,
    // Historical acceptance does not establish current light-client freshness or governance admission.
    currentSourceStatus,currentProfileStatus};
}

/** Explicit wallet boundary: callers supply signing and confirmed-inclusion adapters. */
export async function submitEthereumTezosAttachment(input: Parameters<typeof buildEthereumTezosAttachment>[0] & {
  rpc:string; expectedChainId:string; expectedProfile:Hex; fetcher?:typeof fetch;
  wallet:{getChainId():Promise<string>;sendOperation(operation:TezosTransactionOperation):Promise<string>};
  waitForConfirmation(hash:string):Promise<{applied:boolean;blockHash:string}>;
}) {
  const operation=buildEthereumTezosAttachment(input);
  const fetcher=input.fetcher??fetch;const base=input.rpc.replace(/\/$/,'');
  if(!/^https?:\/\//.test(base))throw new Error('Invalid chain endpoint');
  bytes(input.expectedProfile,32);
  async function read(path:string,body?:unknown):Promise<any>{
    const response=await fetcher(base+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw new Error('Tezos RPC unavailable');return response.json();
  }
  const chainId=await read('/chains/main/chain_id');
  if(chainId!==input.expectedChainId||await input.wallet.getChainId()!==chainId)throw new Error('Wrong Tezos network');
  const profile=await read('/chains/main/blocks/head/helpers/scripts/run_script_view',{
    contract:input.receiver,view:'profile_id',input:{prim:'Unit'},chain_id:chainId,unparsing_mode:'Readable'});
  if(`0x${profile.data?.bytes}`.toLowerCase()!==input.expectedProfile.toLowerCase())throw new Error('Pinned profile mismatch');
  const hash=await input.wallet.sendOperation(operation);
  const confirmation=await input.waitForConfirmation(hash);
  if(!confirmation.applied)throw new Error('Attachment operation failed');
  const receipt=await readEthereumTezosAttachment({rpc:input.rpc,expectedChainId:chainId,receiver:input.receiver,
    identity:ethereumTezosAttachmentId(input.coordinates),expectedProfile:input.expectedProfile,blockHash:confirmation.blockHash,...(input.fetcher?{fetcher:input.fetcher}:{})});
  const start=Number(input.coordinates.offset)*2,end=Number(input.coordinates.offset+input.coordinates.length)*2;
  const digest=sha256(`0x${bytes(input.code).slice(start,end)}`);
  if(receipt.digest!==digest)throw new Error('Confirmed receipt content mismatch');
  return {hash,confirmation,receipt};
}
