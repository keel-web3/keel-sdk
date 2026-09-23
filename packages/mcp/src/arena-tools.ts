// Staked matches settled from a proof (@keel-engine/arena, carried by the SDK as
// @keel/game-engine/arena). Review-only: the tools turn a workspace match JSON into the
// bytes a contract and a prover see, and a settlement leaf into its Merkle claim. They
// never import a workspace format module -- running a format is executing workspace
// code, so re-running a match (audit, a claim's spent list) is the CLI's job:
// `pnpm game:arena prepare|audit|claim` in an SDK checkout.
//
// The engine ships TypeScript sources with .ts specifiers and is linked from a sibling
// repository, so it is loaded at call time through the SDK's own @keel/game-engine
// exports instead of being compiled into this package: the build and every other tool
// stay independent of it, and a checkout without the engine gets a clear error here.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { McpResource, ToolContext, ToolDefinition } from './types.js';

interface Entrant { readonly tokenId: bigint; readonly seed: Uint8Array; readonly stake: bigint; readonly config: Uint8Array }
interface MatchInput {
  readonly formatId: number; readonly matchId: bigint; readonly paramsDigest: Uint8Array; readonly trackDigest: Uint8Array;
  readonly seed: Uint8Array; readonly n: number; readonly entrantsDigest: Uint8Array;
}
type Settlement = { readonly mode: 'inline'; readonly spent: readonly bigint[] } | { readonly mode: 'merkle'; readonly root: Uint8Array; readonly totalSpent: bigint };
interface ArenaEngine {
  sha256(b: Uint8Array): Uint8Array;
  fromHex(h: string): Uint8Array;
  toHex(b: Uint8Array): string;
  equalBytes(a: Uint8Array, b: Uint8Array): boolean;
  programIdOf(id: string): Uint8Array;
  readPublicValues(b: Uint8Array): { programId: Uint8Array; inputDigest: Uint8Array; result: Uint8Array };
  readonly ZERO32: Uint8Array;
  encodeMatchInput(m: MatchInput): Uint8Array;
  entrantsDigest(matchId: bigint, entrants: readonly Entrant[]): Uint8Array;
  encodeEntrants(entrants: readonly Entrant[]): Uint8Array;
  decodeMatchResult(b: Uint8Array): { n: number; placings: readonly { entrant: number; score: number }[]; settlement: Settlement };
  settlementLeaf(index: number, tokenId: bigint, spent: bigint): Uint8Array;
  settlementTree(leaves: readonly Uint8Array[]): { root: Uint8Array; proof(i: number): Uint8Array[] };
  verifySettlement(root: Uint8Array, n: number, index: number, leaf: Uint8Array, proof: readonly Uint8Array[]): boolean;
}

const ENGINE_EXPORTS = ['sha256', 'fromHex', 'toHex', 'equalBytes', 'programIdOf', 'readPublicValues', 'ZERO32', 'encodeMatchInput', 'entrantsDigest', 'encodeEntrants', 'decodeMatchResult', 'settlementLeaf', 'settlementTree', 'verifySettlement'] as const;
let engine: Promise<ArenaEngine> | undefined;
function loadEngine(): Promise<ArenaEngine> {
  engine ??= (async () => {
    // The SDK checkout this server was built in: packages/mcp/dist -> packages/game-engine. A self-reference keeps its exports map authoritative.
    const require = createRequire(new URL('../../game-engine/package.json', import.meta.url));
    const load = async (part: string) => await import(pathToFileURL(require.resolve(`@keel/game-engine/${part}`)).href) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...await load('codec'), ...await load('proof'), ...await load('arena') };
    const missing = ENGINE_EXPORTS.filter((name) => merged[name] === undefined);
    if (missing.length) throw Error(`the linked engine lacks ${missing.join(', ')}`);
    return merged as unknown as ArenaEngine;
  })().catch((error: unknown) => {
    engine = undefined;
    throw Error(`The staked-match engine is unavailable (${error instanceof Error ? error.message : String(error)}). These tools need an SDK checkout whose @keel/game-engine links @keel-engine/arena and @keel-engine/proof (run \`pnpm game:setup\`), on Node 22.18 or newer (the engine ships TypeScript sources).`);
  });
  return engine;
}

const MATCH_MAX_BYTES = 128_000_000;
const MAX_ENTRANTS = 1_000_000;
const RESPONSE_MAX_BYTES = 262_144;
const U64 = (1n << 64n) - 1n, U128 = (1n << 128n) - 1n, U256 = (1n << 256n) - 1n;

type Args = Record<string, unknown>;
function strictArgs(input: unknown, allowed: readonly string[], label: string): Args {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(`Invalid ${label} request.`);
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Error(`Unsupported ${label} field: ${unknown.join(', ')}.`);
  return input as Args;
}
function uint(value: unknown, max: bigint, label: string): bigint {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/u.test(text)) throw Error(`${label} must be a decimal or 0x string.`);
  const n = BigInt(text);
  if (n > max) throw Error(`${label} is out of range.`);
  return n;
}
function hex(e: ArenaEngine, value: unknown, label: string, maxBytes: number, exactBytes?: number): Uint8Array {
  if (typeof value !== 'string' || value.length > 2 + maxBytes * 2 || !/^0x([0-9a-fA-F]{2})*$/u.test(value)) throw Error(`${label} must be 0x-prefixed hex of at most ${maxBytes} bytes.`);
  const bytes = e.fromHex(value);
  if (exactBytes !== undefined && bytes.length !== exactBytes) throw Error(`${label} must be ${exactBytes} bytes.`);
  return bytes;
}
function optionalPath(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw Error(`${key} must be a workspace path.`);
  return value;
}
async function readJson(context: ToolContext, pathValue: string, maxBytes: number): Promise<unknown> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode((await context.workspace.readFile(pathValue, maxBytes)).bytes));
}

interface LoadedMatch { readonly input: MatchInput; readonly inputBytes: Uint8Array; readonly params: Uint8Array; readonly track: Uint8Array | null; readonly entrants: readonly Entrant[] }

/** The same match.json the CLI reads: { formatId, matchId, seed, params, track | trackPath, entrants: [{ tokenId, seed, stake, config }] }. */
async function loadMatch(context: ToolContext, e: ArenaEngine, matchPath: string): Promise<LoadedMatch> {
  const raw = await readJson(context, matchPath, MATCH_MAX_BYTES) as Args;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('A match file is a JSON object.');
  const formatId = raw.formatId;
  if (typeof formatId !== 'number' || !Number.isInteger(formatId) || formatId < 0 || formatId > 0xffffffff) throw Error('formatId must be a uint32.');
  const matchId = uint(raw.matchId, U64, 'matchId');
  const seed = hex(e, raw.seed, 'seed', 32, 32);
  const params = hex(e, raw.params, 'params', 1_000_000);
  if (raw.track !== undefined && raw.trackPath !== undefined) throw Error('Give track or trackPath, not both.');
  let track: Uint8Array | null = null;
  if (typeof raw.trackPath === 'string') track = (await context.workspace.readFile(join(dirname(matchPath), raw.trackPath), 4_000_000)).bytes;
  else if (raw.trackPath !== undefined) throw Error('trackPath must be a path relative to the match file.');
  else if (raw.track !== undefined && raw.track !== null) track = hex(e, raw.track, 'track', 4_000_000);
  if (!Array.isArray(raw.entrants) || raw.entrants.length === 0 || raw.entrants.length > MAX_ENTRANTS) throw Error(`entrants must list 1 to ${MAX_ENTRANTS} entrants.`);
  const entrants = raw.entrants.map((entry: unknown, i: number): Entrant => {
    const x = entry as Args;
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw Error(`entrant ${i} must be an object.`);
    return { tokenId: uint(x.tokenId, U256, `entrant ${i} tokenId`), seed: hex(e, x.seed, `entrant ${i} seed`, 32, 32), stake: uint(x.stake, U128, `entrant ${i} stake`), config: hex(e, x.config, `entrant ${i} config`, 32, 32) };
  });
  const input: MatchInput = {
    formatId, matchId, paramsDigest: e.sha256(params), trackDigest: track ? e.sha256(track) : e.ZERO32,
    seed, n: entrants.length, entrantsDigest: e.entrantsDigest(matchId, entrants),
  };
  return { input, inputBytes: e.encodeMatchInput(input), params, track, entrants };
}

/** Does a claimed public-values envelope belong to this match? A data check, not an audit: whether the result is the true one needs the format run (the CLI's audit). */
function bindPublicValues(e: ArenaEngine, match: LoadedMatch, args: Args) {
  if (args.publicValues === undefined) {
    if (args.program !== undefined) throw Error('program is checked against publicValues; supply both.');
    return undefined;
  }
  const pv = e.readPublicValues(hex(e, args.publicValues, 'publicValues', 64 + 64 + 1_000_000 * 16));
  if (!e.equalBytes(pv.inputDigest, e.sha256(match.inputBytes))) throw Error('publicValues commit a different match input: they are not a result of this match.');
  if (args.program !== undefined) {
    if (typeof args.program !== 'string' || args.program.length === 0 || args.program.length > 128) throw Error('program must be a format id such as "game/format@1".');
    if (!e.equalBytes(pv.programId, e.programIdOf(args.program))) throw Error(`publicValues were produced by another program than ${args.program}.`);
  }
  const result = e.decodeMatchResult(pv.result);
  if (result.n !== match.input.n) throw Error('publicValues report a different field size than this match.');
  return { programId: e.toHex(pv.programId), inputDigestMatches: true, programMatches: args.program === undefined ? null : true, placings: result.placings, settlement: result.settlement };
}

function digests(e: ArenaEngine, m: LoadedMatch) {
  return {
    formatId: m.input.formatId, matchId: m.input.matchId.toString(), n: m.input.n,
    matchInput: e.toHex(m.inputBytes), inputDigest: e.toHex(e.sha256(m.inputBytes)),
    paramsDigest: e.toHex(m.input.paramsDigest), trackDigest: e.toHex(m.input.trackDigest), entrantsDigest: e.toHex(m.input.entrantsDigest),
  };
}
const REVIEW_ONLY = { signed: false, submitted: false, formatExecuted: false } as const;
const CLI_ROUTE = 'Running the format (public values, audit, a spent list) executes game code: do it outside MCP with `pnpm game:arena prepare|audit|claim <match.json> --format <module>` in the SDK checkout.';

const matchPrepare: ToolDefinition = {
  descriptor: {
    name: 'keel-arena-match-prepare',
    description: 'Turn a workspace staked-match JSON into the generic MatchInput ("HSMI") bytes a contract builds, its inputDigest, the params/track/entrants digests (the sha256 entrant chain), and the prover witness JSON, using @keel-engine/arena for any match format. Optionally checks that claimed public values commit this exact input. Never runs a format module, signs, reads a chain, or submits; re-running a match is the `pnpm game:arena` CLI route.',
    inputSchema: { type: 'object', properties: {
      matchPath: { type: 'string', maxLength: 4096, description: 'Workspace match JSON: {formatId, matchId, seed, params, track | trackPath (relative to the match file), entrants:[{tokenId, seed, stake, config}]}. Hex strings for bytes; decimal or 0x strings for tokenId, matchId and stake.' },
      witnessPath: { type: 'string', maxLength: 4096, description: 'Optional workspace path for the prover witness JSON ({name, input, params, track, entrants}). Required when the witness is too large to return inline.' },
      publicValues: { type: 'string', maxLength: 32_000_300, description: 'Optional claimed public values (0x programId ‖ inputDigest ‖ MatchResult) to bind to this match.' },
      program: { type: 'string', maxLength: 128, description: 'Optional program id (e.g. "hashers/sprint@1") the public values must name; requires publicValues.' },
    }, required: ['matchPath'], additionalProperties: false },
  },
  async run(context, value) {
    const args = strictArgs(value, ['matchPath', 'witnessPath', 'publicValues', 'program'], 'arena match');
    const matchPath = optionalPath(args, 'matchPath'), witnessPath = optionalPath(args, 'witnessPath');
    if (!matchPath) throw Error('Supply a match file.');
    const e = await loadEngine();
    const match = await loadMatch(context, e, matchPath);
    const out = digests(e, match);
    const witness = { name: `match ${out.matchId}`, input: out.matchInput, params: e.toHex(match.params), track: e.toHex(match.track ?? new Uint8Array(0)), entrants: e.toHex(e.encodeEntrants(match.entrants)) };
    const bound = bindPublicValues(e, match, args);
    const result = {
      schema: 'keel-arena-match@1', ...out,
      ...(bound ? { publicValues: jsonSafe(bound) } : {}),
      ...(witnessPath ? { witnessPath: await context.workspace.writeJson(witnessPath, witness) } : { witness }),
      ...REVIEW_ONLY, next: CLI_ROUTE,
    };
    if (!witnessPath && JSON.stringify(result).length > RESPONSE_MAX_BYTES) throw Error('This field\'s witness is too large to return inline; supply witnessPath.');
    return result;
  },
};

const claimPrepare: ToolDefinition = {
  descriptor: {
    name: 'keel-arena-claim-prepare',
    description: 'Build a big field\'s Merkle settlement claim from a workspace match JSON and the per-entrant spent list: leaf(i) = sha256(0x00 ‖ i ‖ tokenId ‖ spent), the sibling proof for index i, the root, and the contract claim arguments, checked with the same verifySettlement a contract runs. With publicValues it also proves the spent list reproduces the settled root and totalSpent. Never runs a format module, signs, reads a chain, or submits; a spent list from the format itself is `pnpm game:arena claim --format`.',
    inputSchema: { type: 'object', properties: {
      matchPath: { type: 'string', maxLength: 4096, description: 'Workspace match JSON, the same file keel-arena-match-prepare reads.' },
      index: { type: 'integer', minimum: 0, maximum: MAX_ENTRANTS - 1, description: 'Entrant index (entry order) to claim for.' },
      spent: { type: 'array', maxItems: 4096, items: { type: 'string', maxLength: 80 }, description: 'SCRAP spent by each entrant in entry order (decimal or 0x strings). Use spentPath for larger fields.' },
      spentPath: { type: 'string', maxLength: 4096, description: 'Workspace JSON holding the spent list: an array, or {spent:[...]} as the CLI prints.' },
      publicValues: { type: 'string', maxLength: 32_000_300, description: 'Optional settled public values; the claim is checked against their Merkle root and totalSpent.' },
      program: { type: 'string', maxLength: 128, description: 'Optional program id the public values must name; requires publicValues.' },
    }, required: ['matchPath', 'index'], additionalProperties: false },
  },
  async run(context, value) {
    const args = strictArgs(value, ['matchPath', 'index', 'spent', 'spentPath', 'publicValues', 'program'], 'arena claim');
    const matchPath = optionalPath(args, 'matchPath'), spentPath = optionalPath(args, 'spentPath');
    if (!matchPath) throw Error('Supply a match file.');
    if ((args.spent === undefined) === (spentPath === undefined)) throw Error('Supply exactly one of spent or spentPath.');
    const e = await loadEngine();
    const match = await loadMatch(context, e, matchPath);
    const n = match.input.n;
    const index = args.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= n) throw Error(`index must name one of this match's ${n} entrants.`);
    let list: unknown = args.spent;
    if (spentPath) { const raw = await readJson(context, spentPath, MATCH_MAX_BYTES) as Args; list = Array.isArray(raw) ? raw : raw?.spent; }
    if (!Array.isArray(list) || list.length !== n) throw Error(`The spent list must have one entry per entrant (${n}).`);
    const spent = list.map((s, i) => {
      const v = uint(s, U128, `spent[${i}]`);
      if (v > match.entrants[i]!.stake) throw Error(`spent[${i}] exceeds entrant ${i}'s stake; no settled result can contain it.`);
      return v;
    });
    const totalSpent = spent.reduce((a, s) => a + s, 0n);
    const tree = e.settlementTree(match.entrants.map((x, i) => e.settlementLeaf(i, x.tokenId, spent[i]!)));
    const leaf = e.settlementLeaf(index, match.entrants[index]!.tokenId, spent[index]!);
    const proof = tree.proof(index);
    if (!e.verifySettlement(tree.root, n, index, leaf, proof)) throw Error('The settlement proof does not verify.');
    const bound = bindPublicValues(e, match, args);
    if (bound?.settlement.mode === 'inline') throw Error('These public values settle inline: every stake was applied in the settle call, so there is nothing to claim.');
    if (bound?.settlement.mode === 'merkle') {
      if (!e.equalBytes(bound.settlement.root, tree.root)) throw Error('The spent list does not reproduce the settled Merkle root; a claim built from it would be rejected.');
      if (bound.settlement.totalSpent !== totalSpent) throw Error('The spent list does not sum to the settled totalSpent.');
    }
    const tokenId = match.entrants[index]!.tokenId.toString();
    const proofHex = proof.map(e.toHex);
    return {
      schema: 'keel-arena-claim@1', formatId: match.input.formatId, matchId: match.input.matchId.toString(), n, inputDigest: e.toHex(e.sha256(match.inputBytes)),
      index, tokenId, spent: spent[index]!.toString(), totalSpent: totalSpent.toString(), leaf: e.toHex(leaf), root: e.toHex(tree.root), proof: proofHex, verified: true,
      settlement: bound ? { mode: 'merkle', rootMatches: true, totalSpentMatches: true, programId: bound.programId, programMatches: bound.programMatches } : { mode: 'unchecked', note: 'Without publicValues the root is only what this spent list implies; a match settled inline needs no claim.' },
      claimCall: { function: 'claim(uint64 matchId, uint256 index, uint256 tokenId, uint128 spent, bytes32[] proof)', args: [match.input.matchId.toString(), String(index), tokenId, spent[index]!.toString(), proofHex] },
      ...REVIEW_ONLY, next: CLI_ROUTE,
    };
  },
};

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `0x${Buffer.from(v).toString('hex')}` : v)));
}

export const ARENA_TOOL_DEFINITIONS: readonly ToolDefinition[] = [matchPrepare, claimPrepare];

export const ARENA_RESOURCE_URI = 'keel://mcp/arena' as const;
export const ARENA_RESOURCE_DEFINITION: McpResource = { uri: ARENA_RESOURCE_URI, name: 'keel-arena', description: 'Staked matches settled from a proof: the generic MatchInput/MatchResult wire, how to add a match format (TS, Rust, on-chain registration), and the MCP/CLI boundary.', mimeType: 'application/json' };
export const ARENA_RESOURCE_TEXT: Readonly<Record<string, string>> = { [ARENA_RESOURCE_URI]: `${JSON.stringify({
  schema: 'keel-mcp-resource@1',
  kind: 'staked-match-formats',
  packages: {
    arena: { import: '@keel/game-engine/arena', source: '@keel-engine/arena', readme: 'keel-engine/packages/arena/README.md' },
    proof: { import: '@keel/game-engine/proof', source: '@keel-engine/proof', readme: 'keel-engine/packages/proof/README.md' },
    rust: { crate: 'keel-proof', module: 'arena', path: 'keel-engine/zk/keel-proof/src/arena.rs' },
  },
  wire: {
    matchInput: '"HSMI" · u8 version 1 · u32 formatId · u64 matchId · bytes32 paramsDigest · bytes32 trackDigest (or zero) · bytes32 seed · u32 n · bytes32 entrantsDigest; inputDigest = sha256(matchInput)',
    entrant: 'u256 tokenId · bytes32 seed · u128 stake · bytes32 config (112 bytes)',
    entrantChain: 'd0 = sha256("HSME" ‖ u64 matchId), d(i+1) = sha256(d(i) ‖ entrant i)',
    matchResult: '"HSMR" · u8 1 · u32 n · u8 k ≤ 32 · k × (u32 entrant · u32 score) · u8 mode · inline: n × u128 spent | merkle: bytes32 root · u128 totalSpent',
    publicValues: 'bytes32 programId = sha256("game/format@version") · bytes32 inputDigest · MatchResult',
    settlementTree: 'leaf = sha256(0x00 ‖ u32 i ‖ u256 tokenId ‖ u128 spent), node = sha256(0x01 ‖ left ‖ right), levels left to right, an odd last node promoted; proof is siblings bottom-up, index picks the side',
  },
  addFormat: [
    { step: 'typescript', what: 'In the game (e.g. src/consensus/program.ts) export defineMatchFormat<Params>({ id: "game/format@1", formatId, inlineMax, encodeParams, decodeParams, run }) from @keel/game-engine/arena. run is the rules only: placings (≤ 32, distinct) and spent[i] ≤ stake per entrant, in integers with the proof roll. The engine checks digests and picks inline vs Merkle settlement.', guard: 'Call assertProvableSource (@keel/game-engine/proof) on the provable directory from the game\'s own test: no floats, **, clocks or dmath.' },
    { step: 'rust', what: 'Port run to a zkVM guest around keel_proof::arena::run_format(&Format { id, format_id, inline_max }, input, params, track, entrants, |m| rules). id, formatId and inlineMax must equal the TS format byte for byte; pin parity with parityVectors from @keel/game-engine/proof.' },
    { step: 'register', what: 'The arena admin registers the program: registerFormat(formatId, { programId: sha256(id), verifier (pins the guest vkey), entryMode, minEntrants, maxEntrants, inlineMax, enabled }). Formats are immutable once registered. This is a wallet transaction and is never prepared or sent by MCP.' },
  ],
  reference: { format: 'keel-games/redline/game/src/consensus/program.ts (SPRINT, hashers/sprint@1)', guest: 'hashers/zk/hashers-race/src/lib.rs', contract: 'hashers/contracts/src/Arena.sol', spec: 'hashers/docs/SPEC.md §4, §5.3–5.5' },
  tools: {
    'keel-arena-match-prepare': 'match JSON → MatchInput hex, inputDigest, params/track/entrants digests, prover witness JSON; optional public-values binding check.',
    'keel-arena-claim-prepare': 'match JSON + spent list → leaf, Merkle proof for index i, root, claim arguments; optional check against settled public values.',
  },
  cli: {
    prepare: 'pnpm game:arena prepare <match.json> --format <module> --out <prover.json>   (runs the format: public values, placings)',
    audit: 'pnpm game:arena audit <match.json> --format <module> --public-values <0x...>   (re-runs the match; what anyone can do without a prover)',
    claim: 'pnpm game:arena claim <match.json> --format <module> --index <i>   (the spent list from the format itself)',
  },
  boundary: [
    'MCP never imports a workspace format module: a format is game code, and importing it runs that code with the server\'s full privileges, outside the workspace file confinement every tool relies on. An agent that can write the workspace could otherwise execute anything by asking for an audit.',
    'So a true audit (is this the correct result?) and a format-derived spent list are the CLI route, run by a person in their own checkout. MCP checks only data: that public values commit this match input, name the expected program, and settle to the root a spent list implies.',
    'No tool signs, reads a chain, or submits; registerFormat, settle and claim are wallet transactions reviewed outside MCP.',
  ],
})}\n` };
