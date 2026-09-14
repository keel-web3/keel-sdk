import { concatHex, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, sha256, stringToHex, toHex, type Address, type Hex } from "viem";
import { createKeelNativeObjectPlan } from "./native-publication.js";
import { planKeelAssetPresentation } from "./presentation.js";
import { keelHoldAbi } from "./abi.js";

const holdAbi = parseAbi(keelHoldAbi);
export interface KeelManagedObject {
  readonly objectId: Hex;
  readonly digest: Hex;
  readonly byteLength: number;
  readonly storedByteLength: number;
  readonly mediaType: string;
  readonly chunks: readonly { id: Hex; bytes: Uint8Array }[];
  readonly operations: readonly { target: Address; value: bigint; data: Hex }[];
  readonly newBytes: number;
  readonly reusedBytes: number;
  readonly presentation: ReturnType<typeof planKeelAssetPresentation>;
}

/** Native KEEL storage has no artwork-size policy. Bounded leaves and composites
 * feed the existing managed job; presentation is chosen independently. */
export async function createKeelManagedObjectPlan(input: Uint8Array, options: {
  readonly hold: Address;
  readonly mediaType: string;
  /** Prepared URI fragments and shared encoded resources must remain directly readable. */
  readonly compression?: "auto" | "none";
  readonly readSlug?: (id: Hex) => Promise<Uint8Array | null>;
}): Promise<KeelManagedObject> {
  const source = input.slice();
  if (!source.length) throw new Error("The original file is empty.");
  const chunks = new Map<Hex, Uint8Array>();
  const operations: { target: Address; value: bigint; data: Hex }[] = [];
  type Part = { id: Hex; bytes: Uint8Array; stored: number };
  let level: Part[] = [];
  for (let offset = 0; offset < source.length; offset += 512 * 1024) {
    const bytes = source.slice(offset, offset + 512 * 1024);
    const storedCandidates = [bytes];
    if (options.compression !== "none") storedCandidates.push(new Uint8Array(await new Response(
      new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()));
    const candidates = await Promise.all(storedCandidates.map(stored => createKeelNativeObjectPlan(stored, {
      objectName: "publication-leaf", mediaType: options.mediaType, keccak256,
      ...(options.readSlug ? { readSlug: options.readSlug } : {}),
    })));
    // Existing exact bytes win over a redundant compressed copy. Otherwise choose
    // the cheaper native write; Gzip uses the canonical shell's existing decoder.
    const codec: 0 | 1 = options.compression !== "none" && candidates[1]!.storedBytes < candidates[0]!.storedBytes ? 1 : 0;
    const selected = candidates[codec]!;
    for (const bytes of selected.chunks) chunks.set(keccak256(bytes), bytes);
    const digest = sha256(bytes), length = BigInt(bytes.length), stored = BigInt(selected.byteLength);
    const id = keccak256(encodeAbiParameters(
      [{type:"bytes1"},{type:"bytes32"},{type:"bytes32"},{type:"uint64"},{type:"uint64"},{type:"uint8"},{type:"bytes32"}],
      ["0x00",keccak256(concatHex(selected.slugIds)),digest,length,stored,codec,keccak256(stringToHex(options.mediaType))],
    ));
    operations.push({ target: options.hold, value: 0n, data: encodeFunctionData({abi:holdAbi,functionName:"weldObject",args:[selected.slugIds,digest,length,codec,options.mediaType]}) });
    level.push({ id, bytes, stored: selected.byteLength });
  }
  while (level.length > 1) {
    const next: Part[] = [];
    for (let index = 0; index < level.length; index += 128) {
      const parts = level.slice(index,index+128), bytes = new Uint8Array(parts.reduce((n,p)=>n+p.bytes.length,0));
      let offset=0; for(const part of parts){bytes.set(part.bytes,offset);offset+=part.bytes.length;}
      const ids=parts.map(p=>p.id), stored=parts.reduce((n,p)=>n+p.stored,0), digest=sha256(bytes);
      const composite = createKeelManagedCompositePlan(ids, bytes, {hold:options.hold, mediaType:options.mediaType, storedByteLength:stored});
      const id = composite.objectId;
      operations.push(composite.operation);
      next.push({id,bytes,stored});
    }
    level=next;
  }
  const root=level[0]!, missing=[...chunks].map(([id,bytes])=>({id,bytes})), newBytes=missing.reduce((n,c)=>n+c.bytes.length,0);
  return {objectId:root.id,digest:sha256(source),byteLength:source.length,storedByteLength:root.stored,mediaType:options.mediaType,
    chunks:missing,operations,newBytes,reusedBytes:root.stored-newBytes,
    presentation:planKeelAssetPresentation({originalByteLength:source.length,compressedByteLength:root.stored})};
}

/** Read the exact declared tree, not unrelated slugs that happen to exist in Hold.
 * Per-leaf decoding is necessary when a composite contains compressed leaves. */
export async function readKeelManagedObject(id: Hex, ports: {
  readonly record: (id: Hex) => Promise<{ digest: Hex; byteLength: bigint; storedByteLength: bigint; compression: number; composite: boolean; chunkCount: number }>;
  readonly parts: (id: Hex, count: number) => Promise<readonly Hex[]>;
  readonly slug: (id: Hex, index: number) => Promise<readonly [Hex, boolean]>;
}, depth = 0): Promise<Uint8Array> {
  if(depth>16)throw new Error("Invalid KEEL object depth.");
  const record=await ports.record(id);
  const length=Number(record.byteLength);
  if(!Number.isSafeInteger(length)||length<=0)throw new Error("Invalid KEEL object length.");
  const concatenate=(parts:readonly Uint8Array[],size:number)=>{const bytes=new Uint8Array(size);let offset=0;for(const p of parts){if(offset+p.length>size)throw new Error("KEEL object length mismatch.");bytes.set(p,offset);offset+=p.length;}if(offset!==size)throw new Error("KEEL object length mismatch.");return bytes;};
  let decoded: Uint8Array;
  if(record.composite){
    const ids=await ports.parts(id,record.chunkCount);
    if(ids.length!==record.chunkCount)throw new Error("Missing KEEL children.");
    const children:Uint8Array[]=[];for(const child of ids)children.push(await readKeelManagedObject(child,ports,depth+1));
    decoded=concatenate(children,length);
  }else{
    const parts:Uint8Array[]=[];
    for(let i=0;i<record.chunkCount;i++){
      const [hex,more]=await ports.slug(id,i);
      if(more!==(i+1<record.chunkCount))throw new Error("KEEL slug count mismatch.");
      const raw=new Uint8Array((hex.length-2)/2);for(let j=0;j<raw.length;j++)raw[j]=Number.parseInt(hex.slice(2+j*2,4+j*2),16);parts.push(raw);
    }
    const stored=concatenate(parts,Number(record.storedByteLength));
    if(record.compression===0)decoded=stored;
    else if(record.compression===1||record.compression===2){
      const stream=new Blob([Uint8Array.from(stored).buffer]).stream().pipeThrough(new DecompressionStream(record.compression===1?"gzip":"deflate"));
      const reader=stream.getReader(), decodedParts:Uint8Array[]=[];let total=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>length)throw new Error("KEEL decompression exceeded its committed length.");decodedParts.push(value);}}finally{await reader.cancel();}
      decoded=concatenate(decodedParts,length);
    }else throw new Error("This KEEL object needs its declared decoder.");
  }
  if(decoded.length!==length||sha256(decoded).toLowerCase()!==record.digest.toLowerCase())throw new Error("KEEL object digest mismatch.");
  return decoded;
}

/** The same native composite operation used by managed tree publication, exposed
 * for graphs that reuse registered modules and shared prepared resources. */
export function createKeelManagedCompositePlan(ids: readonly Hex[], bytes: Uint8Array, options: {
  readonly hold: Address; readonly mediaType: string; readonly storedByteLength?: number;
}) {
  const stored = options.storedByteLength ?? bytes.length;
  if (ids.length < 1 || ids.length > 128 || !bytes.length || !Number.isSafeInteger(stored) || stored < 1) throw new Error("Invalid KEEL composite");
  const digest = sha256(bytes), byteLength = BigInt(bytes.length);
  const objectId = keccak256(encodeAbiParameters(
    [{type:"bytes1"},{type:"bytes32"},{type:"bytes32"},{type:"uint64"},{type:"uint64"},{type:"bytes32"}],
    ["0x01",keccak256(concatHex(ids)),digest,byteLength,BigInt(stored),keccak256(stringToHex(options.mediaType))]));
  return {objectId,digest,byteLength,operation:{target:options.hold,value:0n,
    data:encodeFunctionData({abi:holdAbi,functionName:"weldComposite",args:[ids,digest,byteLength,options.mediaType]})}};
}
