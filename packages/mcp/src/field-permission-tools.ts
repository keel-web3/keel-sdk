import {
  buildKeelFieldSchema,
  decodeKeelFieldSchema,
  keelFieldForm,
  keelFieldMask,
  prepareKeelFieldEdit,
  prepareKeelFieldFreeze,
  prepareKeelFieldGrant,
  prepareKeelFieldRevoke,
  prepareKeelFieldSchema,
  renderKeelFields,
  splitKeelFieldEdit,
  type KeelFieldSchema,
} from "@keel/sdk/field-permissions";
import type { JsonSchema, ToolDefinition } from "./types.js";

/**
 * MCP doors to KEEL field permissions: creator-defined, user-editable token
 * fields on the shared KeelFieldRegistry (EVM) or keel_field_registry (Tezos).
 * Every tool is offline preparation over the same KF v1 schema bytes on both
 * chains. None accepts key material, signs, submits, or reads a chain.
 */

const FAMILY: JsonSchema = { type: "string", enum: ["evm", "tezos"], description: "Chain family: evm (KeelFieldRegistry) or tezos (keel_field_registry)." };
const ADDRESS: JsonSchema = { type: "string", minLength: 36, maxLength: 42, description: "0x address (EVM) or tz1-4/KT1 address (Tezos)." };
const NATURAL: JsonSchema = { anyOf: [{ type: "integer", minimum: 0 }, { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" }] };
const HEX: JsonSchema = { type: "string", pattern: "^0x(?:[0-9a-fA-F]{2})*$" };
const FIELDS: JsonSchema = { type: "array", minItems: 1, maxItems: 64, items: { anyOf: [{ type: "string" }, { type: "integer", minimum: 0, maximum: 63 }] } };
const SCHEMA_INPUT: JsonSchema = {
  anyOf: [
    { type: "object", required: ["fields"], properties: { fields: { type: "array", minItems: 1, maxItems: 64, items: { type: "object" } }, ui: { type: "object" } }, additionalProperties: false },
    HEX,
  ],
  description: "JSON field definitions ({fields:[{name, kind: bool|uint|int|enum|color|bytes|string, scope, listed, default, min, max, step, options, selectable, alpha, minLength, maxLength, charset, validator, approvedOnly}], ui}) or existing KF v1 schema hex.",
};
const ATOM: JsonSchema = {
  type: "object", required: ["kind"], additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["creator", "account", "account-set", "merkle", "signed", "token-owner", "pointer-owner"] },
    account: ADDRESS, root: HEX, issuer: { type: "string", description: "EVM issuer address (EOA or ERC-1271) or Tezos issuer public key (edpk/sppk/p2pk)." },
  },
};
const RULE: JsonSchema = {
  type: "object", required: ["ruleId", "fields", "atoms"], additionalProperties: false,
  properties: { ruleId: { type: "integer", minimum: 0, maximum: 15 }, fields: FIELDS, atoms: { type: "array", minItems: 1, maxItems: 4, items: ATOM }, tokenId: NATURAL },
};
const TARGET = { family: FAMILY, registry: ADDRESS, collection: ADDRESS } as const;
const SECRET = /(?:private|secret|mnemonic|seed|passphrase)/iu;

function input(value: unknown, label: string): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} requires an object.`);
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (SECRET.test(key)) throw new TypeError(`Private signer material is never accepted by ${label}: ${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, "input");
  return value as Record<string, any>;
}

/** JSON-safe copy: bigints become decimal strings, byte arrays are dropped in favour of their hex twins. */
function json(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return undefined;
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, json(v)]).filter(([, v]) => v !== undefined));
  }
  return value;
}

function schemaOf(value: unknown): KeelFieldSchema {
  return typeof value === "string" ? decodeKeelFieldSchema(value) : buildKeelFieldSchema(value as never);
}

function tool(name: string, description: string, inputSchema: JsonSchema, run: ToolDefinition["run"]): ToolDefinition {
  return { descriptor: { name, description, inputSchema }, run };
}

export const FIELD_PERMISSION_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  tool(
    "keel-field-schema-prepare",
    "Design editable token fields for a collection and prepare the shared field registry calls (EVM) or operations (Tezos): claim the collection's field space, publish the KF v1 schema (identical bytes on both chains, validated with the registries' exact refusal reasons), set custom validators and rules, and enable EVM ERC-4906 notices or Tezos token_info attribute patching. With freeze, prepares an irreversible field or token freeze, a schema weld, or pause/unpause instead. Returns the Studio form descriptor and the default rendered fields/attributes. Review-only: no RPC, signing or submission; the claim must be sent by the collection's live authority.",
    {
      type: "object", additionalProperties: false, required: ["family", "registry", "collection", "schema"],
      properties: {
        ...TARGET, schema: SCHEMA_INPUT, claim: { type: "boolean" }, previousSchema: HEX, frozenFields: FIELDS,
        validators: { type: "array", maxItems: 8, items: ADDRESS }, rules: { type: "array", maxItems: 16, items: RULE },
        notify: { type: "boolean", description: "EVM only." }, metadataPatch: { type: "boolean", description: "Tezos only." },
        freeze: { type: "object", additionalProperties: false, required: ["freeze"], properties: { freeze: { type: "string", enum: ["fields", "token", "schema", "pause", "unpause"] }, fields: FIELDS, tokenId: NATURAL } },
      },
    },
    async (_context, value) => {
      const args = input(value, "keel-field-schema-prepare");
      const schema = schemaOf(args.schema);
      const target = { family: args.family, registry: args.registry, collection: args.collection };
      if (args.freeze !== undefined) return json(prepareKeelFieldFreeze({ ...target, schema, ...args.freeze }));
      const previous = args.previousSchema === undefined ? undefined : decodeKeelFieldSchema(args.previousSchema);
      const prepared = prepareKeelFieldSchema({
        ...target, schema, claim: args.claim, validators: args.validators, rules: args.rules, notify: args.notify, metadataPatch: args.metadataPatch,
        ...(previous ? { previousSchema: previous.bytes, frozenMask: args.frozenFields ? keelFieldMask(previous, args.frozenFields) : 0n } : {}),
      });
      return json({ ...prepared, form: keelFieldForm(schema), defaults: renderKeelFields(schema) });
    },
  ),
  tool(
    "keel-field-grant-prepare",
    "Open or close field editing. grant: rule (fields + AND of gate atoms: creator, account, account-set, merkle, signed, token-owner, pointer-owner, optional single-token filter), accounts (add to an account-set rule), pointer (an item token whose editors are the live owner of a token in any collection: ERC-721 ownerOf / ERC-1155 balanceOf / FA2 get_balance), merkle (builds the chain-bound allowlist tree, returns root, per-entry proofs and the rule call), or signature (returns the EIP-712 FieldGrant typed data or the Tezos PACKed payload an issuer signs, optionally bound to exact values, with its witness). With revoke instead: disable a rule (voids its outstanding signatures and proofs), remove accounts, clear a pointer, cancel nonces, or hand over the space. Review-only: no signing or submission.",
    {
      type: "object", additionalProperties: false, required: ["family", "registry", "collection"],
      properties: {
        ...TARGET, schema: SCHEMA_INPUT,
        grant: { type: "string", enum: ["rule", "accounts", "pointer", "merkle", "signature"] },
        revoke: { type: "string", enum: ["rule", "accounts", "pointer", "nonces", "admin"] },
        rule: RULE, ruleId: { type: "integer", minimum: 0, maximum: 15 }, fields: FIELDS, accounts: { type: "array", minItems: 1, maxItems: 512, items: ADDRESS },
        tokenId: NATURAL, target: ADDRESS, targetTokenId: NATURAL, standard: { type: "string", enum: ["erc721", "erc1155", "fa2"] },
        entries: { type: "array", minItems: 1, maxItems: 65_536, items: { type: "object", required: ["account", "fields"], additionalProperties: false, properties: { account: ADDRESS, tokenId: NATURAL, fields: FIELDS } } },
        extraAtoms: { type: "array", maxItems: 3, items: ATOM }, editor: ADDRESS, values: { type: "object" }, nonce: NATURAL, deadline: NATURAL,
        chainId: { type: "integer", minimum: 1 }, network: { type: "string", pattern: "^Net[1-9A-HJ-NP-Za-km-z]{12}$" },
        issuer: ADDRESS, nonces: { type: "array", minItems: 1, maxItems: 256, items: NATURAL }, admin: ADDRESS,
      },
    },
    async (_context, value) => {
      const args = input(value, "keel-field-grant-prepare");
      if ((args.grant === undefined) === (args.revoke === undefined)) throw new TypeError("Choose exactly one of grant or revoke.");
      if (args.revoke !== undefined) return json(prepareKeelFieldRevoke(args as never));
      if (args.schema === undefined) throw new TypeError("A grant needs the collection's schema to name fields.");
      return json(prepareKeelFieldGrant({ ...args, schema: schemaOf(args.schema) } as never));
    },
  ),
  tool(
    "keel-field-edit-prepare",
    "Prepare an editor's field edit: JSON values ({name: value}) are converted to KF v1 wire bytes and checked with the registries' built-in rules (enum options, integer range and step, string length and charset, strict UTF-8, colors, bools, byte lengths) before anything is prepared; refusals name the onchain reason and field. witnesses are keyed by atom index of the claimed rule: merkle {leafToken, leafFields, proof} or signed {grantFields, nonce, deadline, bindValues, signature}. Custom validators, freezes, pause and ownership are checked onchain at submit. Returns the call/operation plus the rendered fields after the edit when current values are supplied. Review-only: no signing or submission.",
    {
      type: "object", additionalProperties: false, required: ["family", "registry", "collection", "schema", "tokenId", "ruleId", "values"],
      properties: {
        ...TARGET, schema: SCHEMA_INPUT, tokenId: NATURAL, ruleId: { type: "integer", minimum: 0, maximum: 15 }, values: { type: "object" },
        witnesses: { type: "object", description: "Keyed by atom index 0..3: merkle {kind, leafToken, leafFields, proof} or signed {kind, grantFields, nonce, deadline, bindValues, signature}." }, editor: ADDRESS,
        current: { type: "object", description: "Optional current wire values by field index, for the rendered preview." },
      },
    },
    async (_context, value) => {
      const args = input(value, "keel-field-edit-prepare");
      const schema = schemaOf(args.schema);
      const prepared = prepareKeelFieldEdit({ ...args, schema } as never);
      const current: Record<number, string> = { ...(args.current ?? {}) };
      Object.assign(current, splitKeelFieldEdit(schema, BigInt(prepared.mask), prepared.values));
      return json({ ...prepared, preview: renderKeelFields(schema, current) });
    },
  ),
];

