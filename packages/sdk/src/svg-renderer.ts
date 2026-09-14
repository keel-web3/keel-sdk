import { encodeFunctionData, keccak256, parseAbi, sha256, stringToHex, type Address, type Hex } from 'viem';

export const KEEL_SVG_SCHEMA = 'keel.svg-native@1' as const;
export const KEEL_SVG_ABI = parseAbi([
  'function svg(uint256 tokenId) view returns (string)',
  'function svgProvenance(uint256 tokenId) view returns (string)',
]);
export type KeelSVGTarget = { chainId: number; address: Address; tokenId: string; codeHash?: Hex };
export type KeelSVGProvenance = {
  schema: typeof KEEL_SVG_SCHEMA;
  renderer: { chainId: string; address: Address; tokenId: string; codeHash: Hex; method: 'svg(uint256)' };
  artwork: { hash: 'sha256'; digest: Hex; bytes: string };
  generation: { source: Address; seed: Hex };
  proof: { schema: Hex; source: Address; job: Hex; statement: Hex; beneficiary: Address; kind: number; work: string; seed: Hex } | null;
  verification: { method: 'same-block-contract-readback'; storage: 'evm-code-and-state' };
};
const bytes = (value: string) => new TextEncoder().encode(value).length;
const address = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const uint = (value: unknown, bits = 256) => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << BigInt(bits);
function keys(value: any, names: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== names.sort().join()) throw Error('Unexpected SVG provenance fields.');
}
/** A deliberately passive SVG subset. Inspection never inserts markup into a DOM. */
export function validateKeelSVGArtwork(art: string) {
  const allowed = new Set(['g','path','rect','circle','ellipse','line','polyline','polygon']);
  const attributes = new Set(['d','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','width','height','points','transform','fill','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','fill-rule','stroke-linecap','stroke-linejoin']);
  const stack: string[] = [];
  const text = art.replace(/<([/]?)([a-z]+)([^<>]*)>/g, (_, close: string, tag: string, tail: string) => {
    if (!allowed.has(tag)) throw Error('SVG contains an unsupported or active element.');
    if (close) { if (tail || stack.pop() !== tag) throw Error('Unbalanced SVG elements.'); return ''; }
    const self = tail.endsWith('/'); if (self) tail = tail.slice(0,-1); else stack.push(tag);
    if (stack.length > 64) throw Error('SVG nesting exceeds 64 groups.');
    const seen = new Set<string>();
    const rest = tail.replace(/\s+([a-z-]+)="([^"<>]*)"/g, (_: string, name: string, value: string) => {
      if (!attributes.has(name) || seen.has(name) || /[&\\]|url\s*\(/i.test(value)) throw Error('SVG contains an unsupported attribute.');
      seen.add(name);
      if (!/^[a-z0-9#.,()+\s-]*$/i.test(value)) throw Error('SVG attribute must be passive geometry or colour.');
      return '';
    });
    if (rest.trim()) throw Error('Invalid SVG attributes.');
    return '';
  });
  if (text.trim() || stack.length) throw Error('Invalid or unbalanced SVG artwork.');
}
export function validateKeelSVGTarget(target: KeelSVGTarget): KeelSVGTarget {
  if (!target || !Number.isSafeInteger(target.chainId) || target.chainId < 1 || !address(target.address) || !uint(target.tokenId) || target.codeHash !== undefined && !hash(target.codeHash)) throw Error('Choose a network, contract and uint256 token ID.');
  return target;
}
export function prepareKeelSVGRead(target: KeelSVGTarget) {
  validateKeelSVGTarget(target);
  return { chainId: target.chainId, to: target.address, data: encodeFunctionData({ abi: KEEL_SVG_ABI, functionName: 'svg', args: [BigInt(target.tokenId)] }), method: 'eth_call', signing: 'not-required', verification: 'not-performed', schema: KEEL_SVG_SCHEMA };
}
export function keelSVGDataURI(svg: string): string { inspectKeelSVG(svg); return `data:image/svg+xml,${encodeURIComponent(svg)}`; }
export function decodeKeelSVG(value: string): string {
  if (typeof value !== 'string' || value.length > 1_500_000) throw Error('SVG exceeds the input limit.');
  return value.startsWith('data:image/svg+xml,') ? decodeURIComponent(value.slice(19)) : value;
}
/** Hash/shape checking only. A copied or fabricated document can pass this; use verifyKeelSVG for chain evidence. */
export function inspectKeelSVG(input: string) {
  const source = decodeKeelSVG(input);
  if (bytes(source) > 150_000) throw Error('SVG exceeds the native renderer limit.');
  const match = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 ([1-9][0-9]{0,9}) ([1-9][0-9]{0,9})" shape-rendering="crispEdges">\n<metadata id="keel-verification"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>\n<g id="keel-artwork">([\s\S]*)<\/g>\n<\/svg>$/.exec(source);
  if (!match || Number(match[1]) > 0xffffffff || Number(match[2]) > 0xffffffff) throw Error('Not a canonical KEEL native SVG document.');
  const provenance = JSON.parse(match[3]!) as KeelSVGProvenance, art = match[4]!;
  keys(provenance,['schema','renderer','artwork','generation','proof','verification']);
  keys(provenance.renderer,['chainId','address','tokenId','codeHash','method']);
  keys(provenance.artwork,['hash','digest','bytes']);
  keys(provenance.generation,['source','seed']);
  if(provenance.proof!==null)keys(provenance.proof,['schema','source','job','statement','beneficiary','kind','work','seed']);
  keys(provenance.verification,['method','storage']);
  const {renderer:r, artwork:a, proof:p, verification:v} = provenance;
  if (provenance.schema !== KEEL_SVG_SCHEMA || !uint(r.chainId) || r.chainId === '0' || !uint(r.tokenId) || !address(r.address) || !hash(r.codeHash) || r.method !== 'svg(uint256)' || a.hash !== 'sha256' || !hash(a.digest) || !uint(a.bytes) || !address(provenance.generation.source) || !hash(provenance.generation.seed) || p!==null && (!hash(p.schema) || !address(p.source) || !address(p.beneficiary) || !hash(p.job) || !hash(p.statement) || !hash(p.seed) || !Number.isInteger(p.kind) || p.kind < 0 || p.kind > 255 || !uint(p.work,88)) || v.method !== 'same-block-contract-readback' || v.storage !== 'evm-code-and-state') throw Error('Invalid SVG provenance.');
  validateKeelSVGArtwork(art);
  if (bytes(art) > 131_072 || String(bytes(art)) !== a.bytes || sha256(stringToHex(art)).toLowerCase() !== a.digest.toLowerCase()) throw Error('SVG artwork digest or length mismatch.');
  return { source, artwork: art, provenance, byteLength: bytes(source), verification: 'unverified' as const };
}
export type KeelSVGClient = {
  getChainId(): Promise<number>;
  getBlock(input: any): Promise<{number: bigint | null; hash: Hex | null}>;
  getCode(input: any): Promise<Hex | undefined>;
  readContract(input: any): Promise<unknown>;
};
/** All bytes/code come from one finalized block. The caller supplies the trusted coordinates,
 * never an RPC URL/contract chosen from the SVG. This authenticates bytes to that deployment;
 * it does not audit its verifier, establish consensus independently of RPC, or prove seed fairness. */
export async function readKeelSVG(client: KeelSVGClient, target: KeelSVGTarget) {
  validateKeelSVGTarget(target);
  if (await client.getChainId() !== target.chainId) throw Error('SVG network mismatch.');
  const block = await client.getBlock({blockTag:'finalized'});
  if (block.number === null || block.hash === null) throw Error('A finalized chain snapshot is required.');
  const [code, value] = await Promise.all([
    client.getCode({address:target.address, blockNumber:block.number}),
    client.readContract({address:target.address, abi:KEEL_SVG_ABI, functionName:'svg', args:[BigInt(target.tokenId)], blockNumber:block.number}),
  ]);
  if (!code || code === '0x' || typeof value !== 'string') throw Error('Native SVG renderer unavailable.');
  const result = inspectKeelSVG(value), r = result.provenance.renderer, codeHash = keccak256(code);
  if (r.chainId !== String(target.chainId) || r.address.toLowerCase() !== target.address.toLowerCase() || r.tokenId !== target.tokenId || r.codeHash.toLowerCase() !== codeHash || target.codeHash && target.codeHash.toLowerCase() !== codeHash) throw Error('SVG contract identity mismatch.');
  if ((await client.getBlock({blockNumber:block.number})).hash !== block.hash) throw Error('Chain snapshot changed during SVG verification.');
  return {...result, verification:'contract-readback' as const, runtimePinned:!!target.codeHash, blockNumber:block.number.toString(), blockHash:block.hash, codeHash, imageURI:keelSVGDataURI(result.source)};
}
export async function verifyKeelSVG(client: KeelSVGClient, target: KeelSVGTarget, source: string) {
  const supplied = inspectKeelSVG(source), live = await readKeelSVG(client,target);
  if (supplied.source !== live.source) throw Error('SVG does not match the contract output.');
  return live;
}
