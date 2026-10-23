import { sha256 } from "viem";
import { keelTezosExpressionHash } from "./tezos-live-state.js";
import type { TezosMichelineValue } from "./tezos-publication.js";

export interface KeelTezosGlobalConstantOperation {
  readonly kind: "register_global_constant";
  readonly value: TezosMichelineValue;
}
export interface KeelTezosCodeConstant {
  readonly address: string;
  readonly value: TezosMichelineValue;
  readonly bytes: number;
  readonly sha256: string;
  readonly operation: KeelTezosGlobalConstantOperation;
}
export interface KeelTezosCodeConstantPlan {
  readonly schema: "keel.tezos.code-constants@1";
  readonly status: "review-only";
  readonly code: readonly TezosMichelineValue[];
  readonly constants: readonly KeelTezosCodeConstant[];
  readonly originalBytes: number;
  readonly packedBytes: number;
  readonly expandedSha256: string;
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}
/** Use the selected protocol's existing Micheline binary codec. No custom
 * serialization, compression, executable decoder, or viewer carriage is added.
 */
export type KeelTezosMichelineEncoder = (value: TezosMichelineValue) => Uint8Array;
type Path = readonly (number | string)[];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function constant(node: unknown): node is { prim: "constant"; args: readonly [{ string: string }] } {
  return !!node && !Array.isArray(node) && typeof node === "object" && (node as {prim?: string}).prim === "constant";
}
function containsConstant(node: unknown): boolean {
  if (constant(node)) return true;
  if (Array.isArray(node)) return node.some(containsConstant);
  return !!node && typeof node === "object" && Object.values(node).some(containsConstant);
}
function at(root: unknown, path: Path): unknown {
  let node = root;
  for (const key of path) node = (node as Record<string | number, unknown>)[key];
  return node;
}
function replace(root: unknown, path: Path, value: unknown): void {
  if (path.length === 0) throw new TypeError("A script root cannot be a constant.");
  (at(root, path.slice(0, -1)) as Record<string | number, unknown>)[path[path.length - 1] as string | number] = value;
}
/** Recompute every content address before expanding. Independent constants have
 * no reference cycles or registration-order surprises. Unknown refs fail closed.
 */
export function expandKeelTezosCodeConstants(
  code: readonly TezosMichelineValue[], constants: readonly KeelTezosCodeConstant[], encode: KeelTezosMichelineEncoder,
): readonly TezosMichelineValue[] {
  const values = new Map<string, TezosMichelineValue>();
  for (const entry of constants) {
    const binary = encode(entry.value);
    if (containsConstant(entry.value) || binary.length !== entry.bytes || sha256(binary) !== entry.sha256
      || keelTezosExpressionHash(binary) !== entry.address || values.has(entry.address)) throw new TypeError("Invalid global-constant evidence.");
    values.set(entry.address, entry.value);
  }
  const expand = (node: unknown): unknown => {
    if (constant(node)) {
      const address = node.args?.[0]?.string, value = values.get(address);
      if (!value) throw new TypeError("Unresolved global constant: " + address);
      return clone(value);
    }
    if (Array.isArray(node)) return node.map(expand);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, expand(value)]));
    return node;
  };
  return expand(code) as readonly TezosMichelineValue[];
}
/** Replace exact AST nodes, never instruction fragments or reordered code.
 * Supply expanded compiler output. Existing references must first be read back
 * from the selected chain. Registration/readback and actual-wallet simulation
 * remain required; a local plan is not an originated contract.
 */
export function planKeelTezosCodeConstants(
  original: readonly TezosMichelineValue[], encode: KeelTezosMichelineEncoder,
  options: { readonly targetBytes?: number; readonly maxConstantBytes?: number; readonly minimumSavings?: number } = {},
): KeelTezosCodeConstantPlan {
  const target = options.targetBytes ?? 27_000, max = options.maxConstantBytes ?? 24_000, minimum = options.minimumSavings ?? 256;
  if (!Number.isSafeInteger(target) || target < 512 || target > 30_000 || !Number.isSafeInteger(max) || max < 512 || max > 24_000
    || !Number.isSafeInteger(minimum) || minimum < 64) throw new RangeError("Unsafe constant-planning limits.");
  if (!Array.isArray(original) || containsConstant(original)) throw new TypeError("Provide expanded canonical compiler output.");
  const code = clone(original), originalBinary = encode(original), constants: KeelTezosCodeConstant[] = [];
  while (encode(code).length > target) {
    const candidates: {path: Path; value: TezosMichelineValue; binary: Uint8Array}[] = [];
    const visit = (node: unknown, path: Path): void => {
      if (!node || typeof node !== "object" || constant(node)) return;
      if (!containsConstant(node)) {
        const value = node as TezosMichelineValue, binary = encode(value);
        if (binary.length <= max && binary.length >= minimum + 64) candidates.push({path, value, binary});
      }
      if (Array.isArray(node)) node.forEach((value, index) => visit(value, [...path, index]));
      else if (Array.isArray((node as {args?: unknown}).args)) ((node as {args: unknown[]}).args).forEach((value, index) => visit(value, [...path, "args", index]));
    };
    code.forEach((field, index) => {
      if (Array.isArray(field) || !("prim" in field)) return;
      // Only bodies/types of parameter, storage, code and view. Keep the script
      // declarations and view names as required by Michelson's top-level grammar.
      if (!["parameter", "storage", "code", "view"].includes(field.prim)) throw new TypeError("Unknown script field.");
      field.args?.forEach((arg: TezosMichelineValue, n: number) => { if (field.prim !== "view" || n !== 0) visit(arg, [index, "args", n]); });
    });
    candidates.sort((a, b) => b.binary.length - a.binary.length || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)));
    const selected = candidates[0];
    if (!selected) throw new RangeError("Contract still exceeds the operation budget; no safe independent AST node fits.");
    const address = keelTezosExpressionHash(selected.binary);
    if (!constants.some(c => c.address === address)) constants.push({address, value: clone(selected.value), bytes: selected.binary.length,
      sha256: sha256(selected.binary), operation: {kind: "register_global_constant", value: clone(selected.value)}});
    replace(code, selected.path, {prim: "constant", args: [{string: address}]});
  }
  const expanded = expandKeelTezosCodeConstants(code, constants, encode);
  if (JSON.stringify(expanded) !== JSON.stringify(original) || sha256(encode(expanded)) !== sha256(originalBinary)) throw new Error("Constant expansion changed compiler output.");
  return {schema: "keel.tezos.code-constants@1", status: "review-only", code, constants, originalBytes: originalBinary.length,
    packedBytes: encode(code).length, expandedSha256: sha256(originalBinary), signing: "not-performed", submission: "not-performed"};
}
