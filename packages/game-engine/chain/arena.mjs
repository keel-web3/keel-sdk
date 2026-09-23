#!/usr/bin/env node
// pnpm game:arena <command> -- staked matches settled from a proof (@keel-engine/arena), for
// any game's match format. Offline: nothing here signs, submits or reads a chain.
//
//   pnpm game:arena prepare <match.json> [--format <module> --out <prover.json>]
//       The generic MatchInput a contract builds, its digests, and the witness a prover takes.
//       With --format (a module exporting a MatchFormat, e.g. a game's src/consensus/index.ts)
//       it also runs the match and prints the public values a proof must commit.
//   pnpm game:arena audit <match.json> --format <module> --public-values <0x...>
//       Re-run the match and check claimed public values (what anyone can do without a prover).
//   pnpm game:arena claim <match.json> --format <module> --index <i>
//       A big field's settlement: entrant i's leaf, its spent SCRAP and the Merkle proof to claim with.
//
// match.json: { formatId, matchId, seed, params, track | trackPath, entrants: [{ tokenId, seed, stake, config }] }
// (hex strings for bytes; decimal or 0x strings for tokenId, matchId and stake).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "@keel-engine/codec";
import { fromHex, toHex } from "@keel-engine/proof";
import { encodeEntrants, encodeMatchInput, entrantsDigest, settlementLeaf, settlementTree, ZERO32 } from "@keel-engine/arena";

const argv = process.argv.slice(2);
const option = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const [command, file] = argv;
if (!command || !file || argv.includes("--help")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 17).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(command ? 0 : 1);
}

const raw = JSON.parse(readFileSync(file, "utf8"));
const big = (v) => BigInt(v);
const track = raw.trackPath ? new Uint8Array(readFileSync(resolve(file, "..", raw.trackPath))) : raw.track ? fromHex(raw.track) : null;
const params = fromHex(raw.params);
const entrants = raw.entrants.map((e) => ({ tokenId: big(e.tokenId), seed: fromHex(e.seed), stake: big(e.stake), config: fromHex(e.config) }));
const input = {
  formatId: Number(raw.formatId), matchId: big(raw.matchId), paramsDigest: sha256(params), trackDigest: track ? sha256(track) : ZERO32,
  seed: fromHex(raw.seed), n: entrants.length, entrantsDigest: entrantsDigest(big(raw.matchId), entrants),
};
const inputBytes = encodeMatchInput(input);
const witness = { params, track, entrants: encodeEntrants(entrants) };

async function loadFormat() {
  const path = option("--format");
  if (!path) { console.error("--format <module exporting a MatchFormat> is required for this command"); process.exit(1); }
  const mod = await import(pathToFileURL(resolve(path)).href);
  const format = Object.values(mod).find((v) => v && typeof v === "object" && v.formatId === input.formatId && typeof v.execute === "function");
  if (!format) { console.error(`${path} exports no MatchFormat with formatId ${input.formatId}`); process.exit(1); }
  return format;
}

if (command === "prepare") {
  const out = {
    matchInput: toHex(inputBytes), inputDigest: toHex(sha256(inputBytes)),
    paramsDigest: toHex(input.paramsDigest), trackDigest: toHex(input.trackDigest), entrantsDigest: toHex(input.entrantsDigest), n: input.n,
  };
  const prover = { name: `match ${raw.matchId}`, input: out.matchInput, params: toHex(params), track: toHex(track ?? new Uint8Array(0)), entrants: toHex(witness.entrants) };
  if (option("--format")) {
    const format = await loadFormat();
    const x = format.execute(input, witness);
    out.program = format.id;
    out.programId = toHex(format.programId);
    out.publicValues = prover.publicValues = toHex(x.publicValues);
    out.placings = x.result.placings;
    out.settlement = x.result.settlement.mode;
  }
  if (option("--out")) writeFileSync(option("--out"), JSON.stringify(prover, null, 1) + "\n");
  console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} else if (command === "audit") {
  const format = await loadFormat();
  const claimed = option("--public-values");
  if (!claimed) { console.error("--public-values <0x...> is required"); process.exit(1); }
  const verdict = format.audit(input, witness, fromHex(claimed));
  console.log(verdict.ok ? "ok: the claimed public values are this match's result" : `MISMATCH: ${verdict.reason}\nexpected ${toHex(verdict.expected)}`);
  process.exit(verdict.ok ? 0 : 1);
} else if (command === "claim") {
  const format = await loadFormat();
  const i = Number(option("--index"));
  const run = format.runMatch({ matchId: input.matchId, seed: input.seed, params: format.decodeParams(params), track, entrants });
  const tree = settlementTree(entrants.map((e, k) => settlementLeaf(k, e.tokenId, run.spent[k])));
  console.log(JSON.stringify({ index: i, tokenId: entrants[i].tokenId.toString(), spent: run.spent[i].toString(), root: toHex(tree.root), proof: tree.proof(i).map(toHex) }, null, 2));
} else {
  console.error(`unknown command ${command} (prepare, audit, claim)`);
  process.exit(1);
}
