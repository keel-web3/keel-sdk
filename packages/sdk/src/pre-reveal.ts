import {
  canonicalJson, createKeelCommitment, createKeelMerkleCommitment, verifyKeelMerkleProof,
  sealKeelContent, openKeelContent, createKeelRpcClient,
  type Hex, type KeelMerkleProof, type KeelRpcClientOptions,
} from "@keel/protocol";
import {encodeFunctionData,decodeFunctionResult,parseAbi,keccak256} from "viem";
import {validateKeelMarketplaceMetadata} from "./collector-metadata.js";
import type {KeelApplicationPanel,KeelShellClient} from "./verification-shell-client.js";

export const KEEL_PREREVEAL_PROTOCOL="keel-prereveal@1" as const;
export type KeelPreRevealMode="assets"|"seeded"|"attributes"|"encrypted";
export interface KeelPreRevealRecipe {
  readonly generatorDigest:Hex;
  readonly parametersDigest:Hex;
  /** Commits the actual mint randomness rule/profile, rather than a future guessed seed. */
  readonly seedRuleDigest:Hex;
  readonly rasterProfileDigest?:Hex;
  readonly burnRuleDigest?:Hex;
}
export interface KeelPreRevealToken {
  readonly tokenId:string;
  readonly assetBytes?:Uint8Array;
  /** A creator can supply a precomputed SHA-256 instead of loading the asset. */
  readonly assetHash?:Hex;
  readonly attributes?:readonly Readonly<Record<string,unknown>>[];
  readonly recipe?:KeelPreRevealRecipe;
  /** Include only when assignment is already known before commitment. */
  readonly seed?:Hex;
}
export interface KeelPreRevealManifest {
  readonly protocol:typeof KEEL_PREREVEAL_PROTOCOL;
  readonly chainId:number;
  readonly collection:string;
  readonly mode:KeelPreRevealMode;
  readonly root:Hex;
  readonly count:number;
}
export interface KeelPreRevealProof {
  readonly tokenId:string;
  readonly proof:KeelMerkleProof;
}
const DIGEST=/^0x[0-9a-f]{64}$/iu;
const address=(value:string)=>{if(typeof value!=="string"||!/^0x[0-9a-f]{40}$/iu.test(value)||/^0x0{40}$/iu.test(value))throw new TypeError("Invalid reveal address");return value.toLowerCase() as Hex;};
const tokenId=(v:string)=>{if(typeof v!=="string"||!/^(?:0|[1-9][0-9]{0,77})$/u.test(v)||BigInt(v)>=1n<<256n)throw new TypeError("Invalid reveal token ID");return v;};
const digest=(v:Hex)=>{if(typeof v!=="string"||!DIGEST.test(v))throw new TypeError("Reveal hashes must be bytes32");return v.toLowerCase() as Hex;};
const bytesHash=async(bytes:Uint8Array)=>(await createKeelCommitment(bytes,{salt:"none"})).digest;
// Only a code-pinned read can produce an anchor trusted by this module. A
// serialized/application-supplied object never upgrades the publication claim.
const checkedAnchors=new WeakSet<KeelPreRevealAnchor>();
export function normalizeKeelPreRevealManifest(value:KeelPreRevealManifest):KeelPreRevealManifest {
  if(!value||typeof value!=="object"||Object.keys(value).some(k=>!["protocol","chainId","collection","mode","root","count"].includes(k)))throw new TypeError("Unknown prereveal manifest field");
  if(value.protocol!==KEEL_PREREVEAL_PROTOCOL||!Number.isSafeInteger(value.chainId)||value.chainId<1
    ||!["assets","seeded","attributes","encrypted"].includes(value.mode)||!Number.isInteger(value.count)||value.count<1||value.count>65_535)throw new TypeError("Invalid prereveal manifest");
  const collection=address(value.collection);
  return Object.freeze({protocol:KEEL_PREREVEAL_PROTOCOL,chainId:value.chainId,collection,mode:value.mode,root:digest(value.root),count:value.count});
}

async function tokenContent(manifest:Pick<KeelPreRevealManifest,"chainId"|"collection"|"mode">,token:KeelPreRevealToken) {
  if(Object.keys(token).some(k=>!["tokenId","assetBytes","assetHash","attributes","recipe","seed"].includes(k)))throw new TypeError("Unknown prereveal token field");
  const id=tokenId(token.tokenId);
  let assetHash=token.assetHash===undefined?undefined:digest(token.assetHash);
  if(token.assetBytes!==undefined){
    if(!(token.assetBytes instanceof Uint8Array)||token.assetBytes.byteLength>16*1024*1024)throw new RangeError("Reveal assets are limited to 16 MiB per token");
    const actual=await bytesHash(token.assetBytes);if(assetHash&&actual!==assetHash)throw new Error("Asset bytes do not match the supplied hash");assetHash=actual;
  }
  let attributes:readonly unknown[]|undefined;
  if(token.attributes!==undefined){
    validateKeelMarketplaceMetadata({attributes:token.attributes});
    attributes=[...token.attributes].sort((a,b)=>String(a.trait_type)<String(b.trait_type)?-1:String(a.trait_type)>String(b.trait_type)?1:0);
  }
  let recipe:KeelPreRevealRecipe|undefined;
  if(token.recipe){
    if(Object.keys(token.recipe).some(k=>!["generatorDigest","parametersDigest","seedRuleDigest","rasterProfileDigest","burnRuleDigest"].includes(k)))throw new TypeError("Unknown generator commitment field");
    recipe={generatorDigest:digest(token.recipe.generatorDigest),parametersDigest:digest(token.recipe.parametersDigest),seedRuleDigest:digest(token.recipe.seedRuleDigest),
      ...(token.recipe.rasterProfileDigest?{rasterProfileDigest:digest(token.recipe.rasterProfileDigest)}:{}),...(token.recipe.burnRuleDigest?{burnRuleDigest:digest(token.recipe.burnRuleDigest)}:{})};
  }
  if((manifest.mode==="assets"||manifest.mode==="encrypted")&&!assetHash)throw new TypeError("Asset reveals require the exact art hash");
  if(manifest.mode==="attributes"&&!attributes?.length)throw new TypeError("Attribute reveals require the assigned token traits");
  if(manifest.mode==="seeded"&&!recipe)throw new TypeError("Seeded reveals require generator, parameters and seed-rule commitments");
  const content=canonicalJson({domain:"keel-prereveal-token@1",chainId:manifest.chainId,collection:address(manifest.collection),mode:manifest.mode,tokenId:id,
    ...(assetHash?{assetHash}:{}),...(attributes?{attributes}:{}),...(recipe?{recipe}:{}),...(token.seed?{seed:digest(token.seed)}:{})});
  return {content,assetHash,attributes,recipe};
}

/** One salted Merkle root covers the complete assignment. Publish only manifest.
 * Private proofs include salts; no plaintext, trait list or key travels in it.
 */
export async function prepareKeelPreReveal(input:{readonly chainId:number;readonly collection:string;readonly mode:KeelPreRevealMode;readonly tokens:readonly KeelPreRevealToken[]}) {
  if(!Array.isArray(input.tokens)||input.tokens.length<1||input.tokens.length>65_535)throw new RangeError("A prereveal allocation needs 1..65535 tokens");
  const base=normalizeKeelPreRevealManifest({protocol:KEEL_PREREVEAL_PROTOCOL,chainId:input.chainId,collection:input.collection,mode:input.mode,root:`0x${"00".repeat(32)}`,count:input.tokens.length});
  const ids=new Set<string>(),tokens=[...input.tokens].sort((a,b)=>BigInt(tokenId(a.tokenId))<BigInt(tokenId(b.tokenId))?-1:1),contents:string[]=[];
  for(const token of tokens){const id=tokenId(token.tokenId);if(ids.has(id))throw new TypeError("Duplicate token assignment");ids.add(id);contents.push((await tokenContent(base,token)).content);}
  const tree=await createKeelMerkleCommitment(contents);
  const manifest=Object.freeze({...base,root:tree.root});
  const privateProofs=Object.freeze(tokens.map((token,index)=>Object.freeze({tokenId:token.tokenId,proof:tree.proofFor(index)})));
  return Object.freeze({manifest,privateProofs,publication:"not-performed" as const});
}

export interface KeelPreRevealAnchor {
  readonly chainId:number;readonly collection:string;readonly registry:string;readonly revision:string;
  readonly root:Hex;readonly publishedAtBlock:string;readonly publisher:string;readonly snapshotBlock:string;
}

/** Membership/assignment proof, independently of any network connection.
 * A matching recipe is not proof of a rendered image or future mint randomness.
 */
export async function verifyKeelPreReveal(input:{readonly manifest:KeelPreRevealManifest;readonly token:KeelPreRevealToken;readonly reveal:KeelPreRevealProof;readonly anchor?:KeelPreRevealAnchor;readonly mintedSeed?:Hex}) {
  const manifest=normalizeKeelPreRevealManifest(input.manifest);
  if(input.reveal.tokenId!==input.token.tokenId||input.reveal.proof.count!==manifest.count)throw new TypeError("Reveal token/count differs from the committed allocation");
  const content=await tokenContent(manifest,input.token);
  const matches=await verifyKeelMerkleProof(manifest.root,content.content,input.reveal.proof);
  const anchor=input.anchor;
  const anchored=anchor!==undefined&&checkedAnchors.has(anchor)&&anchor.chainId===manifest.chainId&&address(anchor.collection)===manifest.collection&&digest(anchor.root)===manifest.root;
  const seedMatches=input.mintedSeed!==undefined&&input.token.seed!==undefined?digest(input.mintedSeed)===digest(input.token.seed):undefined;
  return Object.freeze({protocol:"keel-prereveal-check@1" as const,tokenId:input.token.tokenId,matches,anchored,
    assetBytesMatched:matches&&input.token.assetBytes!==undefined,
    attributeAssignmentMatched:matches&&content.attributes!==undefined,
    generatorRecipeMatched:matches&&content.recipe!==undefined,
    ...(seedMatches===undefined?{}:{seedMatches}),
    ...(anchored?{publishedAtBlock:anchor!.publishedAtBlock,registry:anchor!.registry}:{}),
    needsMintSeedCheck:manifest.mode==="seeded"&&seedMatches===undefined,
    needsBurnEventCheck:content.recipe?.burnRuleDigest!==undefined,
    needsGeneratorReplay:manifest.mode==="seeded"});
}

const ROOT_ABI=/* @__PURE__ */parseAbi([
  "struct Commitment {bytes32 root;uint64 publishedAt;address publisher;uint8 authority;bool exists;}",
  "function publish(address collection,bytes32 root) returns(uint64)",
  "function commitmentAt(address collection,uint64 revision) view returns(Commitment)",
]);
/** Existing append-only KEEL root registry; no new collection or per-token upload.
 * This protocol checks membership in the SDK, not registry.verify's different
 * (metadataDigest,assetDigest) leaf scheme. Always pin the publication revision.
 */
export function buildKeelPreRevealCommitCall(manifest:KeelPreRevealManifest,registry:string) {
  const m=normalizeKeelPreRevealManifest(manifest),to=address(registry);
  if(/^0x0{64}$/u.test(m.root)||/^0x0{40}$/iu.test(to))throw new TypeError("A nonzero root and registry are required");
  return Object.freeze({chainId:m.chainId,to,data:encodeFunctionData({abi:ROOT_ABI,functionName:"publish",args:[m.collection as `0x${string}`,m.root]}),value:"0x0",
    protocol:KEEL_PREREVEAL_PROTOCOL,signing:"not-performed" as const,submission:"not-performed" as const});
}
/** Optional root read; callers can show "not checked" if RPC is denied. */
export async function readKeelPreRevealAnchor(input:{readonly manifest:KeelPreRevealManifest;readonly registry:string;readonly runtimeCodeHash:Hex;readonly revision:string;readonly rpc:KeelRpcClientOptions}) {
  const m=normalizeKeelPreRevealManifest(input.manifest),registry=address(input.registry);
  if(input.rpc.family!=="ethereum"||input.rpc.chainId!==m.chainId||!/^\d+$/u.test(input.revision)||BigInt(input.revision)>=1n<<64n)throw new TypeError("Reveal registry/chain/revision mismatch");
  const runtimeCodeHash=digest(input.runtimeCodeHash);
  const rpc=createKeelRpcClient({...input.rpc,verifyChainId:true,timeoutMs:Math.min(input.rpc.timeoutMs??8000,8000),maxResponseBytes:65_536,signal:input.rpc.signal??AbortSignal.timeout(20_000)});
  const snapshot=await rpc.snapshot();
  const block={blockHash:snapshot.blockHash,requireCanonical:true} as const;
  const code=await rpc.getCode(registry,block);
  if(code==="0x"||keccak256(code as Hex)!==runtimeCodeHash)throw new Error("Reveal registry differs from the registered runtime code");
  const data=await rpc.call({to:registry,data:encodeFunctionData({abi:ROOT_ABI,functionName:"commitmentAt",args:[m.collection as `0x${string}`,BigInt(input.revision)]}),block});
  const row=decodeFunctionResult({abi:ROOT_ABI,functionName:"commitmentAt",data:data as `0x${string}`});
  if(!row.exists||row.root.toLowerCase()!==m.root||row.authority<1||row.authority>2||row.publishedAt>BigInt(snapshot.blockNumber))throw new Error("Published prereveal root does not match");
  const anchor=Object.freeze({chainId:m.chainId,collection:m.collection,registry,revision:input.revision,root:m.root,publishedAtBlock:row.publishedAt.toString(),publisher:row.publisher,snapshotBlock:snapshot.blockNumber});
  checkedAnchors.add(anchor);return anchor;
}

/** Native encrypted envelope: compress once, then seal; never Base64 the bulk bytes.
 * The returned key stays local until the creator publishes it through the
 * existing reviewed reveal module (prepareLayeredKeyRelease for layered art).
 */
export async function sealKeelPreRevealArtifact(bytes:Uint8Array,mediaType="application/octet-stream") {
  if(!(bytes instanceof Uint8Array)||bytes.length>16*1024*1024)throw new RangeError("Reveal artifacts are limited to 16 MiB");
  const key=crypto.getRandomValues(new Uint8Array(32));
  const sealed=await sealKeelContent(bytes,{mediaType,compression:"auto",slots:[{kind:"raw-key",key}]});
  return {descriptor:Object.freeze({protocol:"keel-prereveal-encrypted@1" as const,ciphertextHash:await bytesHash(sealed.envelope),keyHash:await bytesHash(key),byteLength:sealed.envelope.length}),
    ciphertext:sealed.envelope,key};
}
export async function openKeelPreRevealArtifact(input:{readonly descriptor:{readonly protocol:"keel-prereveal-encrypted@1";readonly ciphertextHash:Hex;readonly keyHash:Hex;readonly byteLength:number};readonly ciphertext:Uint8Array;readonly key:Uint8Array}) {
  if(input.descriptor.protocol!=="keel-prereveal-encrypted@1"||input.key.length!==32||input.ciphertext.length!==input.descriptor.byteLength
    ||await bytesHash(input.ciphertext)!==digest(input.descriptor.ciphertextHash)||await bytesHash(input.key)!==digest(input.descriptor.keyHash))throw new Error("Encrypted reveal data or key differs from its commitment");
  return openKeelContent(input.ciphertext,{kind:"raw-key",key:input.key});
}

/** Optional artwork-side reveal lifecycle. Keep a creator's own placeholder
 * mounted until a public key exists AND opened bytes match the original plan.
 * Concurrent refreshes share one attempt; denial never hides a valid reveal.
 * This does not change the outer shell's resource verification state.
 */
export function createKeelPreRevealArtifactController(input:{
  readonly artifact:Omit<Awaited<ReturnType<typeof sealKeelPreRevealArtifact>>,"key">;
  readonly manifest:KeelPreRevealManifest;
  readonly token:Omit<KeelPreRevealToken,"assetBytes">;
  readonly reveal:KeelPreRevealProof;
  readonly readPublishedKey:()=>Promise<Uint8Array|undefined>;
  readonly mount:(opened:Awaited<ReturnType<typeof openKeelPreRevealArtifact>>,check:Awaited<ReturnType<typeof verifyKeelPreReveal>>)=>void|Promise<void>;
}) {
  let revealed=false,pending:Promise<{readonly phase:"waiting"|"revealed"|"unavailable"}>|undefined;
  return Object.freeze({
    get phase(){return revealed?"revealed":"waiting";},
    refresh(){
      if(revealed)return Promise.resolve({phase:"revealed" as const});
      if(pending)return pending;
      const attempt=(async()=>{
        try {
          const key=await input.readPublishedKey();if(!key)return {phase:"waiting" as const};
          const opened=await openKeelPreRevealArtifact({...input.artifact,key});
          const check=await verifyKeelPreReveal({manifest:input.manifest,token:{...input.token,assetBytes:opened.bytes},reveal:input.reveal});
          if(!check.matches||!check.assetBytesMatched)throw new Error("Opened art differs from the committed token assignment");
          await input.mount(opened,check);revealed=true;return {phase:"revealed" as const};
        }catch{return {phase:"unavailable" as const};}
      })();
      pending=attempt;void attempt.finally(()=>{if(pending===attempt)pending=undefined;});return attempt;
    },
  });
}

/** Reuses standard tabs; it is inert information and cannot change file proof. */
export function keelPreRevealPanel(check:Awaited<ReturnType<typeof verifyKeelPreReveal>>):KeelApplicationPanel {
  return {id:"commitment-reveal",title:"Commitment & reveal",page:"token",description:"Checks the creator's committed plan separately from the file proof.",rows:[
    {label:"Committed data",value:check.matches?"Matches the committed root":"Does not match the committed root"},
    {label:"Publication",value:check.anchored?"Root read via RPC at its recorded KEEL registry revision":"Publication has not been checked"},
    ...(check.publishedAtBlock?[{label:"Committed at block",value:check.publishedAtBlock}]:[]),
    {label:"Art bytes",value:check.assetBytesMatched?"Exact committed bytes matched":"An art-byte match has not been proved"},
    ...(check.attributeAssignmentMatched?[{label:"Token attributes",value:"Match the committed assignment"}]:[]),
    ...(check.generatorRecipeMatched?[{label:"Generator recipe",value:"Matches the committed generator, parameter and seed-rule hashes"}]:[]),
    ...(check.needsMintSeedCheck?[{label:"Mint seed",value:"Requires a read of the actual minted seed"}]:[]),
    ...(check.needsGeneratorReplay?[{label:"Rendered art",value:"Requires replay of the committed generator"}]:[]),
    ...(check.needsBurnEventCheck?[{label:"Burn rule",value:"Requires the corresponding onchain burn-event check"}]:[]),
    ...(check.seedMatches===undefined?[]:[{label:"Mint seed",value:check.seedMatches?"Matches the minted seed":"Differs from the minted seed"}]),
  ]};
}

/** A denied optional anchor read leaves the byte/assignment check usable. */
export async function refreshKeelShellPreRevealInfo(input:{
  readonly manifest:KeelPreRevealManifest;readonly token:KeelPreRevealToken;readonly reveal:KeelPreRevealProof;
  readonly client:Pick<KeelShellClient,"putPanel">;
  readonly readAnchor?:()=>Promise<KeelPreRevealAnchor>;
  readonly mintedSeed?:Hex;
}) {
  let anchor:KeelPreRevealAnchor|undefined;
  try{anchor=await input.readAnchor?.();}catch{/* No network read is required for local membership. */}
  try {
    const check=await verifyKeelPreReveal({manifest:input.manifest,token:input.token,reveal:input.reveal,
      ...(anchor?{anchor}:{}),...(input.mintedSeed?{mintedSeed:input.mintedSeed}:{})});
    await input.client.putPanel(keelPreRevealPanel(check));
    return {available:true,check};
  } catch {return {available:false,error:"Optional reveal information unavailable"};}
}
