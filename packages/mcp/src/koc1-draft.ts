import type { JsonSchema } from './types.js';
import type { Koc1DraftPrepareResponse, Koc1DraftErrors, Koc1DraftErrorField, Koc1VsizeEstimate } from './koc1-draft-types.js';
export type * from './koc1-draft-types.js';
export const KOC1_DRAFT_DEFAULT_FEE_RATE = 2;
const NUMS = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
const text: JsonSchema = {type:'string',maxLength:200};
const formProperties: Record<string, JsonSchema> = {
  mode:{type:'string',enum:['first','time','supply','open']},
  ...Object.fromEntries(['open','close','cap','price','challengeWindow','collectAfter','refundAfter','notice','treasuryKey','metadataRoot','metadataCount','artName'].map(k=>[k,text])),
  ...Object.fromEntries(['earlyRefund','pausable','blind','cycle'].map(k=>[k,{type:'boolean'} as JsonSchema])),
  writers:{type:'array',minItems:3,maxItems:3,items:text},writerKeys:{type:'array',minItems:3,maxItems:3,items:text},
};
export const KOC1_DRAFT_PROPERTIES: Record<string, JsonSchema> = {
  mode:{type:'string',enum:['draft']},draft:{type:'object',additionalProperties:false,properties:formProperties},
  feeRate:{type:'number',minimum:0.001,maximum:1_000_000,description:'Optional sat/vB; defaults to 2. Estimates only, not a live fee quote.'},
};
const deferredChecks = [
  'Finality is not collected by this form and remains null.',
  'Metadata bundle references, viewer and pinned indexer references remain unresolved.',
  'Recipe confirmation before opening, reference byte hashes/locations, and writer operator ownership need later evidence.',
];
const assumptions = [
  'Exact CBOR bytes describe only the unbound draft. Finality and publication references must be filled before publication; their later bytes and fees are not included.',
  'All costs are estimates at the supplied rate (default 2 sat/vB); no live fee quote, chain read, funding selection or signing occurs.',
  'One P2TR funding input and one change output for each commit/reveal, 64-byte SIGHASH_DEFAULT signatures, single-leaf 33-byte control block, 330-sat postage.',
  'Recipe reveal includes one zero-recipe KOC1 marker; mint reveal has recipient, escrow, marker and change. Change amounts are recoverable and excluded from total cost.',
  'The public NUMS point illustrates the unknown buyer/reveal key. Escrow bytes/address are for that example only; actual keys change the tree, but not its sizes.',
  'Mint uses fixed-length example recipe/delegate IDs with a four-byte delegate index (conservative ID width). Actual registered references and wallet shape may change fees.',
  'Escrow leaf vsize measures one input and one P2TR output, with exactly two writer signatures where required; scriptVbytes is the isolated script weight contribution.',
  'Price is held in the escrow output, not paid twice. The escrow output size is already included in reveal vsize; payments below 330 sats receive a dust top-up.',
];
function push(value: Buffer): Buffer {
  const size=value.length;
  return Buffer.concat([size<=75?Buffer.from([size]):size<=255?Buffer.from([0x4c,size]):Buffer.from([0x4d,size&255,size>>>8]),value]);
}
export async function prepareKoc1Draft(input: unknown, lib: Record<string, any>): Promise<Koc1DraftPrepareResponse> {
  if ((JSON.stringify(input)?.length ?? 0)>8_000_000) throw new TypeError('KOC1 draft exceeds 8 MB');
  const errors: Koc1DraftErrors = {};
  const error=(field:Koc1DraftErrorField,message:string)=>{errors[field] ??= message;};
  const a = input && typeof input==='object' && !Array.isArray(input) ? input as Record<string, any> : {};
  const d = a.draft && typeof a.draft==='object' && !Array.isArray(a.draft) ? a.draft as Record<string, any> : {};
  if (Object.keys(a).some(k=>!['mode','draft','feeRate'].includes(k)) || a.mode!=='draft') error('form','Use mode draft with the Studio draft fields and an optional fee rate.');
  if (!a.draft || Object.keys(d).some(k=>!Object.hasOwn(formProperties,k))) error('form','Supply only the fields collected by the KOC1 form.');
  const rate=a.feeRate===undefined ? KOC1_DRAFT_DEFAULT_FEE_RATE : a.feeRate;
  if (typeof rate!=='number' || !Number.isFinite(rate) || rate<0.001 || rate>1_000_000) error('feeRate','Enter a fee rate from 0.001 to 1,000,000 sats per virtual byte.');
  const result: Koc1DraftPrepareResponse = {
    mode:'draft',valid:false,errors,specValid:false,publicationReady:false,signed:false,broadcast:false,chainReads:false,
    recipeEncoding:'cbor',recipeCompleteness:'unbound-draft',recipeBytes:null,recipeByteLength:null,escrow:null,inscriptionCost:null,mintCost:null,
    feeRateSatPerVbyte:errors.feeRate?KOC1_DRAFT_DEFAULT_FEE_RATE:rate,feeRateDefaulted:a.feeRate===undefined,
    deferredChecks:[...deferredChecks],assumptions:[...assumptions],
  };
  const integer=(field:Koc1DraftErrorField,max=0xffffffff):number|undefined=>{
    const v=d[field];return typeof v==='string' && /^(0|[1-9][0-9]*)$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v)<=max?Number(v):undefined;
  };
  const open=integer('open'),close=integer('close'),cap=integer('cap'),price=integer('price',2_100_000_000_000_000),
    w=integer('challengeWindow'),collect=integer('collectAfter'),refund=integer('refundAfter'),notice=integer('notice'),count=integer('metadataCount');
  const capped=d.mode==='first'||d.mode==='supply', timed=d.mode==='first'||d.mode==='time'||(d.mode==='open' && d.close!=='');
  if (!['first','time','supply','open'].includes(d.mode)) error('mode','Choose first, time, supply or open.');
  if (open===undefined) error('open','Enter an opening block height from 0 to 4,294,967,295.');
  if (timed && close===undefined) error('close','Enter a closing block height from 0 to 4,294,967,295.');
  if (timed && close!==undefined && open!==undefined && close<open) error('close','Closing must be at or after opening.');
  if (capped && !cap) error('cap','Enter a maximum of at least one mint, up to 4,294,967,295.');
  if (price===undefined) error('price','Enter a whole number of sats, no more than the Bitcoin money supply.');
  if (!w || w>65535) error('challengeWindow','Enter a challenge window from 1 to 65,535 blocks.');
  if (!collect || collect>65535) error('collectAfter','Enter a collection delay from 1 to 65,535 blocks.');
  else if (w!==undefined && collect<w) error('collectAfter','Collection must wait at least as long as the challenge window.');
  if (!refund || refund>65535) error('refundAfter','Enter a refund delay from 1 to 65,535 blocks.');
  else if (collect!==undefined && refund<=collect) error('refundAfter','Refund must open after collection.');
  if (notice===undefined) error('notice','Enter notice as a whole number of blocks, up to 4,294,967,295.');
  for (const field of ['earlyRefund','pausable','blind','cycle'] as const) if(typeof d[field]!=='boolean') error(field,'Choose true or false.');
  if (d.artName!==undefined && (typeof d.artName!=='string'||d.artName.length>200)) error('artName','Use a name of at most 200 characters.');
  const key=(v:unknown)=>{try{if(typeof v!=='string'||! /^[0-9a-f]{64}$/.test(v))return false;lib.keyOutput(v);return true;}catch{return false;}};
  if (!key(d.treasuryKey)) error('treasuryKey','Enter a valid 32-byte lowercase x-only Bitcoin public key.');
  const keys=Array.isArray(d.writerKeys)?d.writerKeys:[],writers=Array.isArray(d.writers)?d.writers:[];
  if (keys.length!==3) error('writerKeys','Supply exactly three writer public keys.');
  if (writers.length!==3) error('writers','Supply exactly three writer authority inscription IDs.');
  const ids:Buffer[]=[];
  for(let i=0;i<3;i++){
    const k=keys[i],id=writers[i];
    if(!key(k)) error(`key${i}` as Koc1DraftErrorField,'Enter a valid 32-byte lowercase x-only Bitcoin public key.');
    else if(keys.indexOf(k)!==i || k===d.treasuryKey) error(`key${i}` as Koc1DraftErrorField,'Use a different key for every writer and treasury.');
    if(typeof id!=='string'||! /^[0-9a-f]{64}i(0|[1-9][0-9]*)$/.test(id)||!Number.isSafeInteger(Number(id.split('i')[1]))||Number(id.split('i')[1])>0xffffffff) error(`writer${i}` as Koc1DraftErrorField,'Enter an inscription ID: transaction ID followed by i and an index up to 4,294,967,295.');
    else {if(writers.indexOf(id)!==i)error(`writer${i}` as Koc1DraftErrorField,'Use a different inscription for each writer.');const index=Buffer.alloc(4);index.writeUInt32BE(Number(id.split('i')[1]));ids.push(Buffer.concat([Buffer.from(id.slice(0,64),'hex').reverse(),index]));}
  }
  if(typeof d.metadataRoot!=='string'||! /^[0-9a-f]{64}$/.test(d.metadataRoot)) error('metadataRoot','Enter a 32-byte lowercase hex metadata root.');
  if(!count) error('metadataCount','Enter at least one metadata leaf, up to 4,294,967,295.');
  else if(capped && cap && count<cap && !d.cycle) error('metadataCount','Provide at least as many leaves as the maximum, or enable cycling.');
  if(!capped && d.cycle!==true) error('cycle','An edition without a supply cap needs cycling metadata.');
  if(d.blind===true && d.mode==='open' && !timed) error('blind','Blind ordering needs a finite end; provide a closing height or use a capped edition.');
  if(Object.keys(errors).length)return result;
  const payment={mode:'escrow',treasuryKey:d.treasuryKey,writerKeys:keys,collectAfter:collect,refundAfter:refund,earlyRefund:d.earlyRefund};
  const recipe={p:'koc1',op:'recipe',v:1,network:'testnet4',...(d.artName?{name:d.artName}:{}),
    end:{mode:d.mode,open,...(timed?{close}:{}),...(capped?{max:cap}:{})},price,finality:null,challengeWindow:w,
    payment:{...payment,treasuryKey:Buffer.from(d.treasuryKey,'hex'),writerKeys:keys.map((k:string)=>Buffer.from(k,'hex'))},
    controls:{notice,pausable:d.pausable},writers:ids.map(authority=>({authority})),quorum:2,
    metadata:{mode:'merkle',root:Buffer.from(d.metadataRoot,'hex'),count,cycle:d.cycle,order:d.blind?'blind':'direct',bundles:[]},
    art:{viewer:null},indexer:null,writerRegistry:null,bridges:null,checkpoint:null};
  const bytes:Buffer=lib.cbor(recipe),tree=lib.escrowTemplate(payment,NUMS);
  const script='5120'+NUMS,placeholder='00'.repeat(32),sig='00'.repeat(64);
  const sizes=(tx:Record<string,any>):Koc1VsizeEstimate=>{const raw=lib.serializeTx(tx,true),stripped=lib.serializeTx(tx,false);const weight=stripped.length*3+raw.length;return{strippedBytes:stripped.length,totalBytes:raw.length,weight,vsize:Math.ceil(weight/4)};};
  const transaction=(outputs:Record<string,any>[],witness:string[])=>({version:2,locktime:0,inputs:[{txid:placeholder,vout:0,sequence:0xfffffffd,witness}],outputs});
  const output=(value:number,outputScript=script)=>({value,script:outputScript});
  const commit=sizes(transaction([output(1_000_000),output(330)],[sig]));
  const metadata:Buffer[]=[];for(let i=0;i<bytes.length;i+=520)metadata.push(push(Buffer.from([5])),push(bytes.subarray(i,i+520)));
  const envelope=Buffer.concat([push(Buffer.from(NUMS,'hex')),Buffer.from('ac0063','hex'),push(Buffer.from('ord')),push(Buffer.from([7])),push(Buffer.from('koc1')),...metadata,Buffer.from('0068','hex')]).toString('hex');
  const control='c0'+NUMS,recipeMarker=lib.marker('00'.repeat(36));
  const reveal=sizes(transaction([output(330),output(0,recipeMarker),output(330)],[sig,envelope,control]));
  const fee=(size:Koc1VsizeEstimate)=>Math.ceil(size.vsize*rate);
  const fees={estimated:true as const,feeRateSatPerVbyte:rate,commit,commitFeeSats:fee(commit),postageSats:330};
  const template=lib.mintTemplate({recipe:'00'.repeat(36),viewer:'00'.repeat(32)+'ffffffff',minter:NUMS});
  const escrowOutputSats=Math.max(330,price!);
  const mintReveal=sizes(transaction([output(330),output(escrowOutputSats,tree.scriptPubKey),output(0,recipeMarker),output(330)],[sig,template.script,template.controlBlock]));
  const leafSizes=Object.fromEntries(Object.entries(tree.scripts).map(([leaf,leafScript])=>{
    const witness=leaf==='L_m'?[sig,leafScript,tree.controlBlocks[leaf]]:['',sig,sig,sig,leafScript,tree.controlBlocks[leaf]];
    const size=sizes(transaction([output(330)],witness as string[]));
    return[leaf,{...size,scriptBytes:(leafScript as string).length/2,scriptVbytes:(leafScript as string).length/8,controlBytes:tree.controlBlocks[leaf].length/2,witnessBytes:size.totalBytes-size.strippedBytes-2}];
  }));
  return {...result,valid:true,recipeBytes:bytes.toString('hex'),recipeByteLength:bytes.length,
    escrow:{...tree,assumedBuyerKey:NUMS,sizes:leafSizes},
    inscriptionCost:{...fees,reveal,revealFeeSats:fee(reveal),totalFeeSats:fee(commit)+fee(reveal),totalSats:fee(commit)+fee(reveal)+330},
    mintCost:{...fees,reveal:mintReveal,revealFeeSats:fee(mintReveal),totalFeeSats:fee(commit)+fee(mintReveal),
      priceSats:price!,escrowOutputSats,escrowDustTopUpSats:escrowOutputSats-price!,escrowOutputVbytes:43,escrowOutputFeeSats:Math.ceil(43*rate),
      revealSpendSats:fee(mintReveal)+330+escrowOutputSats,totalSats:fee(commit)+fee(mintReveal)+330+escrowOutputSats}};
}
