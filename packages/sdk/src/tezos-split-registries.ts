/**
 * Routing for KEEL contracts that EVM ships as one contract and Tezos splits.
 *
 * A Tezos operation carries at most 32,768 bytes, so a contract whose compiled
 * script is larger cannot be originated whole. Such a contract is split into
 * pieces (keel-contracts module manifests, `tezos.splits`). Studio keeps
 * calling the EVM contract's calls by name; this module says which Tezos piece
 * holds each one, and in what order the pieces are originated.
 *
 * Some pieces cannot take each other's address at origination. A binding is
 * the one-time call, made by the deployer once every piece is originated, that
 * wires them; until it is made, calls that need the other piece fail closed.
 *
 * The table is the generated catalogue, not a hand-kept list: every entrypoint
 * and view of a split lives on exactly one piece, which the catalogue generator
 * checks. Nothing here signs, submits or reads a chain.
 */

import { KEEL_TEZOS_MODULES } from "./tezos-modules.generated.js";

export interface KeelTezosCallTarget {
  /** The Tezos deployable that holds the call. */
  readonly contract: string;
  readonly kind: "entrypoint" | "view";
  readonly name: string;
}

export interface KeelTezosSplitBinding {
  /** The piece that receives the call. */
  readonly on: string;
  readonly entrypoint: string;
  /** The piece whose address is the call's argument. */
  readonly argument: string;
}

interface Surface {
  readonly entrypoints: ReadonlySet<string>;
  readonly views: ReadonlySet<string>;
}

const SURFACES = new Map<string, Surface>();
const SPLITS = new Map<string, readonly string[]>();
const BINDINGS = new Map<string, readonly KeelTezosSplitBinding[]>();
for (const module of KEEL_TEZOS_MODULES) {
  for (const contract of module.deployable) {
    SURFACES.set(contract, {
      entrypoints: new Set(module.entrypoints[contract] ?? []),
      views: new Set(module.views[contract] ?? []),
    });
  }
  for (const [contract, pieces] of Object.entries(module.splits ?? {})) SPLITS.set(contract, Object.freeze([...pieces]));
  for (const [contract, steps] of Object.entries(module.bindings ?? {})) {
    BINDINGS.set(contract, Object.freeze(steps.map((step) => Object.freeze({ ...step }))));
  }
}

/**
 * The Tezos pieces of a KEEL contract, in origination order. A contract that is
 * not split is its own single piece. Each later piece takes the earlier pieces'
 * addresses as constructor inputs.
 */
export function keelTezosPiecesOf(contract: string): readonly string[] {
  const pieces = SPLITS.get(contract);
  if (pieces !== undefined) return pieces;
  if (SURFACES.has(contract)) return Object.freeze([contract]);
  throw new Error(`${contract} is not a catalogued Tezos KEEL deployable.`);
}

/**
 * The one-time calls that wire a split's pieces after every piece is
 * originated, in order. Empty when the pieces need no wiring.
 */
export function keelTezosSplitBindings(contract: string): readonly KeelTezosSplitBinding[] {
  keelTezosPiecesOf(contract);
  return BINDINGS.get(contract) ?? Object.freeze([]);
}

/** True when Tezos implements this KEEL contract as more than one contract. */
export function isKeelTezosSplit(contract: string): boolean {
  return SPLITS.has(contract);
}

/**
 * Which Tezos piece holds a call that Studio makes on a KEEL contract. Fails
 * closed for a call that no piece declares.
 */
export function resolveKeelTezosCall(contract: string, name: string): KeelTezosCallTarget {
  for (const piece of keelTezosPiecesOf(contract)) {
    const surface = SURFACES.get(piece) as Surface;
    if (surface.entrypoints.has(name)) return Object.freeze({ contract: piece, kind: "entrypoint", name });
    if (surface.views.has(name)) return Object.freeze({ contract: piece, kind: "view", name });
  }
  throw new Error(`${contract} has no catalogued Tezos entrypoint or view ${name}.`);
}
