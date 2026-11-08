import { KOC1_DRAFT_PROPERTIES, prepareKoc1Draft } from './koc1-draft.js';
import type { JsonSchema, ToolDefinition } from './types.js';

// This reference package ships native .ts modules (Node >=22.18). Load only on
// invocation so discovery/initialization never incurs curve/indexer startup.
const referencePackage = '@keel/ordinals-collections';
const core = () => import(referencePackage);
type Row = Record<string, any>;
const objectSchema: JsonSchema = { type: 'object', additionalProperties: true };
const hexSchema: JsonSchema = { type: 'string', pattern: '^(?:[0-9a-f]{2})+$', maxLength: 4_000_000 };
const uintSchema: JsonSchema = { type: 'integer', minimum: 0, maximum: 0xffffffff };
const common = { recipe: objectSchema, recipeBytes: hexSchema, recipeId: { type: 'string', maxLength: 80 } as JsonSchema,
  height: uintSchema, txIndex: uintSchema, refs: objectSchema, inscriptions: objectSchema };
const snapshot: JsonSchema = { type: 'object', additionalProperties: false, required: ['height', 'hash', 'candidates'], properties: {
  height: uintSchema, hash: hexSchema, candidates: { type: 'array', maxItems: 10000, items: objectSchema },
  controls: { type: 'array', maxItems: 1000, items: objectSchema }, indexRoot: hexSchema,
} };
function record(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Row;
}
function request(value: unknown, allowed: string[]): Row {
  const args = record(value, 'request');
  if (Object.keys(args).some(k => !allowed.includes(k))) throw new TypeError('Unknown KOC1 request field');
  // Bound recursive CBOR authoring and work even when invoked without schema validation.
  if (JSON.stringify(args).length > 8_000_000) throw new TypeError('KOC1 evidence exceeds 8 MB');
  return args;
}
function hex(value: unknown, bytes?: number): string {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value) || (bytes !== undefined && value.length !== bytes * 2)) throw new TypeError('Invalid hex bytes');
  return value;
}
function uint(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff) throw new TypeError('Invalid block height/index');
  return value as number;
}
function routeId(value: unknown): string {
  if (typeof value === 'string' && /^[0-9a-f]{64}i(?:0|[1-9][0-9]*)$/.test(value)) {
    const [txid, index] = value.split('i'); const n = uint(Number(index)); const suffix = Buffer.alloc(4); suffix.writeUInt32BE(n);
    return Buffer.concat([Buffer.from(txid!, 'hex').reverse(), suffix]).toString('hex');
  }
  return hex(value, 36);
}
function plain(value: any): any {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,plain(v)]));
  return value;
}
const byteFields = new Set(['id', 'authority', 'sha256', 'root', 'treasuryKey', 'writerKeys']);
function wire(value: any, key = ''): any {
  if (Array.isArray(value)) return value.map(v => wire(v,key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,wire(v,k)]));
  if (byteFields.has(key) && typeof value === 'string' && /^(?:[0-9a-f]{2})+$/.test(value)) return Buffer.from(value,'hex');
  return value;
}
const assurance = { verified: false, signed: false, broadcast: false, assurance: 'Reference checks on supplied evidence; chain positions, controls, charms, completeness and current best chain require authenticated sources.' };
async function resolveRecipe(args: Row, lib: Row): Promise<Row | null> {
  const sources = ['recipe','recipeBytes','recipeId'].filter(k => args[k] !== undefined);
  if (sources.length !== 1) throw new TypeError('Supply exactly one of recipe, recipeBytes or recipeId');
  let recipe: Row;
  if (args.recipe !== undefined) recipe = structuredClone(record(args.recipe,'recipe'));
  else {
    let bytes = args.recipeBytes, height = args.height, txIndex = args.txIndex, id: string;
    if (args.recipeId !== undefined) {
      id = routeId(args.recipeId);
      const evidence = args.inscriptions?.[args.recipeId] ?? args.inscriptions?.[id];
      if (!evidence) return null;
      record(evidence,'inscription evidence'); bytes = evidence.bytes; height = evidence.height; txIndex = evidence.txIndex;
    } else {
      // Byte-only verification has a separately supplied location, never a self-ID in the payload.
      id = routeId(args.inscriptionId);
    }
    recipe = record(plain(lib.decodeCbor(Buffer.from(hex(bytes),'hex'))),'decoded recipe');
    if (['id','height','txIndex'].some(k => Object.hasOwn(recipe,k))) throw new TypeError('Recipe payload must not contain its own chain location');
    recipe = { ...recipe, id, height: uint(height), ...(txIndex === undefined ? {} : {txIndex:uint(txIndex)}) };
  }
  hex(recipe.id,36); uint(recipe.height);
  const refs = args.refs === undefined ? {} : record(args.refs,'refs');
  for (const ref of Object.values(refs) as Row[]) { record(ref,'reference'); hex(ref.bytes); uint(ref.height); }
  return {recipe,refs,errors:lib.recipeCheck(recipe,refs)};
}
function checkedSnapshot(input: unknown): Row {
  const s = record(input,'snapshot');
  if (Object.keys(s).some(k => !['height','hash','candidates','controls','indexRoot'].includes(k))) throw new TypeError('Unknown snapshot field');
  uint(s.height); hex(s.hash,32);
  if (!Array.isArray(s.candidates) || s.candidates.length>10000 || (s.controls !== undefined && (!Array.isArray(s.controls) || s.controls.length>1000))) throw new TypeError('Invalid candidate/control list');
  for (const c of s.candidates) {
    record(c,'candidate'); hex(c.rawTx); hex(c.commitTx);
    if (!Array.isArray(c.charms)) throw new TypeError('Candidate charm evidence required');
    if (c.height !== null && c.height !== undefined) { uint(c.height); if (c.height>s.height) throw new TypeError('Candidate is beyond snapshot height'); }
    if (c.txIndex !== null && c.txIndex !== undefined) uint(c.txIndex);
  }
  return s;
}
function projection(lib: Row, resolved: Row, snapshot: Row): Row {
  return lib.indexState(resolved.recipe,resolved.refs,snapshot.candidates,snapshot.height,snapshot.hash,snapshot.controls ?? []);
}
const locationKeys = [...Object.keys(common),'inscriptionId'];
export const KOC1_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    descriptor: {
      name: 'keel-ordinals-collection-prepare',
      description: 'Use mode=draft with the raw Studio form to validate fields and estimate exact unbound CBOR size, escrow and fees without funding or chain reads. For a located recipe, validate a KOC1 testnet4 recipe and supplied references; return canonical CBOR recipe bytes, escrow leaves/key checks and unsigned mint commit/reveal PSBTs. Never signs, broadcasts or treats a supplied recipe location as published proof.',
      inputSchema: { type:'object', additionalProperties:false, properties: {
        ...KOC1_DRAFT_PROPERTIES,mode:{type:'string',enum:['draft','mint']},
        recipe:objectSchema, refs:objectSchema, minter:hexSchema, internalKey:hexSchema,
        funding:{type:'array',minItems:1,maxItems:100,items:objectSchema}, commitValue:{type:'integer',minimum:330},
        commitFee:{type:'integer',minimum:0}, revealFee:{type:'integer',minimum:0}, postage:{type:'integer',minimum:330},
        recipientScript:hexSchema, changeScript:hexSchema,
      } },
    },
    async run(_context,input) {
      if (input && typeof input==='object' && (input as Row).mode==='draft') return prepareKoc1Draft(input,await core());
      const a = request(input,['mode','recipe','refs','minter','internalKey','funding','commitValue','commitFee','revealFee','postage','recipientScript','changeScript']);
      if (a.mode!==undefined && a.mode!=='mint') throw new TypeError('Choose mode draft or mint');
      const lib = await core(), r = await resolveRecipe(a,lib);
      if (!r || r.errors.length) throw new TypeError(`Invalid recipe: ${r?.errors.join(', ')}`);
      if (r.recipe.payment.mode !== 'escrow') throw new TypeError('This escrow mint planner requires escrow payment mode');
      if (!Array.isArray(a.funding) || !a.funding.length || a.funding.length>100) throw new TypeError('Funding inputs required');
      const minter = hex(a.minter,32), tree = lib.escrowTemplate(r.recipe.payment,minter);
      const template = lib.mintTemplate({recipe:r.recipe.id,viewer:r.recipe.art.viewer.id,minter,internalKey:a.internalKey ?? minter});
      const commit = lib.buildCommit({template,inputs:a.funding,value:a.commitValue,fee:a.commitFee,changeScript:a.changeScript});
      // Segwit funding means witness signing does not change the commit txid.
      const rawCommit = lib.serializeTx(commit.tx,false);
      const reveal = lib.buildReveal({commit:rawCommit,template,payment:r.recipe.payment,recipientScript:a.recipientScript,postage:a.postage ?? 330,price:r.recipe.price,fee:a.revealFee,changeScript:a.changeScript});
      const {id,height,txIndex,...payload} = r.recipe;
      const recipeBytes = lib.cbor(wire(payload)).toString('hex');
      const plan = (p: Row) => ({psbt:p.psbt.toString('base64'),encoding:'base64',tx:p.tx,fee:p.fee,protectedOutputs:p.protectedOutputs});
      return {...assurance,valid:true,recipeBytes,recipeEncoding:'cbor',recipeLocation:{id,height,txIndex},
        escrow:tree,keyChecks:{validXOnly:true,distinctTreasuryAndWriters:true,writerKeys:r.recipe.payment.writerKeys,treasuryKey:r.recipe.payment.treasuryKey,operatorOwnership:'not proven by key validity'},
        template,commit:plan(commit),reveal:plan(reveal),
        note:'Mint plan binds the supplied recipe ID. Confirm that recipe and all references before signing; a recipe publication cannot know its own future inscription ID.'};
    },
  },
  {
    descriptor: {
      name:'keel-ordinals-collection-verify',
      description:'Run reference recipe/hash/location checks on a recipe object, CBOR bytes plus location, or inscription ID plus supplied inscription evidence. Optionally recompute index snapshots. Missing ID evidence stays pending; no network fetch or verified collector verdict.',
      inputSchema:{type:'object',additionalProperties:false,properties:{...common,inscriptionId:{type:'string',maxLength:80},indexSnapshots:{type:'array',maxItems:100,items:snapshot}}},
    },
    async run(_context,input) {
      const a=request(input,[...locationKeys,'indexSnapshots']),lib=await core(),r=await resolveRecipe(a,lib);
      if (!r) return {...assurance,valid:false,status:'pending',errors:['recipe inscription bytes and location evidence missing']};
      if (a.indexSnapshots !== undefined && (!Array.isArray(a.indexSnapshots) || a.indexSnapshots.length>100)) throw new TypeError('Invalid snapshots');
      const snapshots = (a.indexSnapshots ?? []).map((s:unknown) => {
        const snapshot=checkedSnapshot(s), state=projection(lib,r,snapshot);
        return {height:state.h,indexRoot:state.indexRoot,minted:state.count,refund:state.over,
          rootMatches:snapshot.indexRoot === undefined ? null : state.indexRoot === hex(snapshot.indexRoot,32)};
      });
      return {...assurance,valid:r.errors.length===0 && snapshots.every((s:Row)=>s.rootMatches!==false),errors:r.errors,snapshots};
    },
  },
  {
    descriptor: {
      name:'keel-ordinals-collection-supply',
      description:'Compute minted, settling, refund and provisional pending counts using the KOC1 reference indexer. Deduplicate and validate pending reveals including commit authentication and next-block controls. Unknown/incomplete mempool coverage produces null pending/remaining, never zero.',
      inputSchema:{type:'object',additionalProperties:false,required:['snapshot'],properties:{...common,inscriptionId:{type:'string',maxLength:80},snapshot,pendingCoverage:{type:'string',enum:['unknown','complete']}}},
    },
    async run(_context,input) {
      const a=request(input,[...locationKeys,'snapshot','pendingCoverage']),lib=await core(),r=await resolveRecipe(a,lib);
      if (!r || r.errors.length) throw new TypeError(`Invalid or unavailable recipe: ${r?.errors.join(', ') ?? 'missing evidence'}`);
      if (a.pendingCoverage !== undefined && !['unknown','complete'].includes(a.pendingCoverage)) throw new TypeError('Invalid pending coverage');
      const snapshot=checkedSnapshot(a.snapshot), state=projection(lib,r,snapshot);
      if (snapshot.indexRoot !== undefined && hex(snapshot.indexRoot,32)!==state.indexRoot) throw new TypeError('Index snapshot root mismatch');
      const unresolvedPositions=snapshot.candidates.filter((x:Row)=>x.height!==null&&x.height!==undefined&&(x.txIndex===null||x.txIndex===undefined)).length;
      const complete=a.pendingCoverage==='complete' && unresolvedPositions===0, seen=new Set<string>();
      const confirmedIds=new Set(snapshot.candidates.filter((x:Row)=>x.height!==null&&x.height!==undefined).map((x:Row)=>lib.parseTx(x.rawTx).txid));
      const pending:Row[]=[];
      for (const c of snapshot.candidates.filter((x:Row)=>x.height===null||x.height===undefined)) {
        const txid=lib.parseTx(c.rawTx).txid;
        if (seen.has(txid)||confirmedIds.has(txid)) continue;
        if (lib.formCheck({...c,recipe:r.recipe,refs:r.refs}).error) continue;
        seen.add(txid);
        pending.push({...c,id:txid,height:uint(snapshot.height+1),txIndex:pending.length});
      }
      const projected=lib.indexState(r.recipe,r.refs,[...snapshot.candidates.filter((x:Row)=>x.height!==null&&x.height!==undefined),...pending],snapshot.height+1,snapshot.hash,snapshot.controls ?? []);
      const eligible=new Set([...projected.members,...projected.refund.filter((x:Row)=>x.reason==='over-cap')].map((x:Row)=>x.txid));
      const pendingCount=pending.filter(c=>eligible.has(c.id)).length;
      const confirmed=state.members.filter((x:Row)=>snapshot.height-x.height+1>=r.recipe.finality).length;
      return {...assurance,minted:state.count,confirmed,settling:state.count-confirmed,refund:state.over,
        pending:complete?pendingCount:null,validatedKnownPending:pendingCount,pendingCoverage:complete?'caller-declared complete':'unknown',
        remaining:complete&&state.cap!==null?Math.max(0,state.cap-state.count-pendingCount):null,cap:state.cap,
        unresolvedPositions,indexRoot:state.indexRoot,canSend:false, note:'Counts are provisional supplied-evidence results. Authenticate complete coverage and current controls before enabling a mint.'};
    },
  },
];
