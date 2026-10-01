import { getAddress, parseAbi, type Address, type Hex } from "viem";

/**
 * Trading rules a collection enforces on transfers, read and changed the same
 * way in Studio, the KEEL editor and agents.
 *
 * Two systems are covered:
 *  - Creator tokens (ERC721-C / ERC1155-C, Limit Break). The collection names a
 *    transfer validator; the validator holds the collection's policy (security
 *    level or ruleset) and the lists it applies (blocked and allowed
 *    marketplaces, authorizers, frozen accounts). Validator v3 and v5 are both
 *    supported; other validators are reported as custom.
 *  - The OpenSea Operator Filter Registry (retired by OpenSea in 2023, still
 *    enforced by contracts that call it). The registry holds a per-collection
 *    filtered operator list or a subscription to someone else's list.
 *
 * Everything here reads or prepares calls. Nothing signs: changes are
 * returned as exact calls for the wallet review flow.
 */

export const KEEL_TRANSFER_RULES_PROTOCOL = "keel-transfer-rules@1" as const;

export const CREATOR_TOKEN_VALIDATORS = {
  v3: getAddress("0x721C0078c2328597Ca70F5451ffF5A7B38D4E947"),
  v5: getAddress("0x721C008fdff27BF06E7E123956E2Fe03B63342e3"),
} as const;
export const OPERATOR_FILTER_REGISTRY = getAddress("0x000000000000AAeB6D7670E522A718067333cd4E");
export const OPENSEA_DEFAULT_FILTER_SUBSCRIPTION = getAddress("0x3cc6CddA760b79bAfa08dF41ECFA224f810dCeB6");

/** Names for well-known marketplace contracts, so lists read as "OpenSea" instead of an address. Informational only. */
export const KNOWN_TRANSFER_OPERATORS: Readonly<Record<string, string>> = {
  [getAddress("0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC").toLowerCase()]: "OpenSea Seaport 1.5",
  [getAddress("0x0000000000000068F116a894984e2DB1123eB395").toLowerCase()]: "OpenSea Seaport 1.6",
  [getAddress("0x1E0049783F008A0085193E00003D00cd54003c71").toLowerCase()]: "OpenSea conduit",
  [getAddress("0x000000000000Ad05Ccc4F10045630fb830B95127").toLowerCase()]: "Blur exchange",
  [getAddress("0x00000000000111AbE46ff893f3B2fdF1F759a8A8").toLowerCase()]: "Blur execution delegate",
  [getAddress("0x0000000000E655fAe4d56241588680F86E3b2377").toLowerCase()]: "LooksRare v2",
  [getAddress("0x74312363e45DCaBA76c59ec49a7Aa8A65a67EeD3").toLowerCase()]: "X2Y2",
};

export const creatorTokenAbi = parseAbi([
  "function getTransferValidator() view returns (address)",
  "function setTransferValidator(address validator)",
  "function getTransferValidationFunction() view returns (bytes4 functionSignature, bool isViewFunction)",
  "event TransferValidatorUpdated(address oldValidator, address newValidator)",
]);

export const transferValidatorV3Abi = parseAbi([
  "function getCollectionSecurityPolicy(address collection) view returns ((bool disableAuthorizationMode, bool authorizersCannotSetWildcardOperators, uint8 transferSecurityLevel, uint120 listId, bool enableAccountFreezingMode, uint16 tokenType))",
  "function getBlacklistedAccountsByCollection(address collection) view returns (address[])",
  "function getWhitelistedAccountsByCollection(address collection) view returns (address[])",
  "function getAuthorizerAccountsByCollection(address collection) view returns (address[])",
  "function getFrozenAccountsByCollection(address collection) view returns (address[])",
  "function getBlacklistedCodeHashesByCollection(address collection) view returns (bytes32[])",
  "function getWhitelistedCodeHashesByCollection(address collection) view returns (bytes32[])",
  "function setTransferSecurityLevelOfCollection(address collection, uint8 level, bool disableAuthorizationMode, bool disableWildcardOperators, bool enableAccountFreezingMode)",
  "function applyListToCollection(address collection, uint120 id)",
  "function createList(string name) returns (uint120 id)",
  "function createListCopy(string name, uint120 sourceListId) returns (uint120 id)",
  "function addAccountsToBlacklist(uint120 id, address[] accounts)",
  "function removeAccountsFromBlacklist(uint120 id, address[] accounts)",
  "function addAccountsToWhitelist(uint120 id, address[] accounts)",
  "function removeAccountsFromWhitelist(uint120 id, address[] accounts)",
  "function freezeAccountsForCollection(address collection, address[] accountsToFreeze)",
  "function unfreezeAccountsForCollection(address collection, address[] accountsToUnfreeze)",
]);

export const transferValidatorV5Abi = parseAbi([
  "function getCollectionSecurityPolicy(address collection) view returns ((uint8 rulesetId, uint48 listId, address customRuleset, uint8 globalOptions, uint16 rulesetOptions, uint16 tokenType))",
  "function getListAccountsByCollection(address collection, uint8 listType) view returns (address[])",
  "function getListCodeHashesByCollection(address collection, uint8 listType) view returns (bytes32[])",
  "function getFrozenAccountsByCollection(address collection) view returns (address[])",
  "function lastListId() view returns (uint48)",
  "function listOwners(uint48 id) view returns (address)",
  "function setRulesetOfCollection(address collection, uint8 rulesetId, address customRuleset, uint8 globalOptions, uint16 rulesetOptions)",
  "function applyListToCollection(address collection, uint48 id)",
  "function createList(string name) returns (uint48 id)",
  "function createListCopy(string name, uint48 sourceListId) returns (uint48 id)",
  "function addAccountsToList(uint48 id, uint8 listType, address[] accounts)",
  "function removeAccountsFromList(uint48 id, uint8 listType, address[] accounts)",
  "function freezeAccountsForCollection(address collection, address[] accountsToFreeze)",
  "function unfreezeAccountsForCollection(address collection, address[] accountsToUnfreeze)",
]);

export const operatorFilterRegistryAbi = parseAbi([
  "function isRegistered(address addr) view returns (bool)",
  "function subscriptionOf(address addr) view returns (address)",
  "function filteredOperators(address addr) view returns (address[])",
  "function isOperatorAllowed(address registrant, address operator) view returns (bool)",
  "function updateOperator(address registrant, address operator, bool filtered)",
  "function updateOperators(address registrant, address[] operators, bool filtered)",
  "function subscribe(address registrant, address registrantToSubscribe)",
  "function unsubscribe(address registrant, bool copyExistingEntries)",
  "function register(address registrant)",
  "function registerAndSubscribe(address registrant, address subscription)",
]);

export const LIST_TYPE = { blocked: 0, allowed: 1, authorizers: 2 } as const;

/** Plain-language meaning of each v3 transfer security level. */
export const V3_SECURITY_LEVELS: readonly { readonly level: number; readonly title: string; readonly detail: string }[] = [
  { level: 0, title: "Recommended", detail: "Only allowed marketplaces can move tokens; owners can still send their own tokens directly." },
  { level: 1, title: "No restrictions", detail: "Any marketplace or contract can trade." },
  { level: 2, title: "Block listed marketplaces", detail: "Everything except blocked marketplaces; owners can send directly." },
  { level: 3, title: "Allowed marketplaces only", detail: "Only allowed marketplaces; owners can send directly." },
  { level: 4, title: "Allowed marketplaces only, no direct sends", detail: "Every transfer goes through an allowed marketplace." },
  { level: 5, title: "Allowed only, no contract receivers", detail: "Allowed marketplaces; tokens can't be sent to contracts." },
  { level: 6, title: "Allowed only, verified wallets receive", detail: "Allowed marketplaces; only verified wallets can receive." },
  { level: 7, title: "Strict, no contract receivers", detail: "Allowed marketplaces only, no direct sends, no contract receivers." },
  { level: 8, title: "Strict, verified wallets receive", detail: "Allowed marketplaces only, no direct sends, only verified wallets receive." },
  { level: 9, title: "Soulbound", detail: "Tokens can't be transferred." },
];

/** Plain-language meaning of each v5 ruleset. */
export const V5_RULESETS: Readonly<Record<number, { readonly title: string; readonly detail: string }>> = {
  0: { title: "Validator default", detail: "Follows the validator's recommended rules (allowed marketplaces)." },
  1: { title: "No restrictions", detail: "Any marketplace or contract can trade." },
  2: { title: "Soulbound", detail: "Tokens can't be transferred." },
  3: { title: "Block listed marketplaces", detail: "Everything except blocked marketplaces." },
  4: { title: "Allowed marketplaces only", detail: "Only allowed marketplaces can trade." },
  255: { title: "Custom ruleset", detail: "A custom ruleset contract decides." },
};

export interface KeelTransferRulesReader {
  readContract(input: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
}

export interface KeelOperatorEntry { readonly address: Address; readonly name?: string }

export interface KeelTransferRules {
  readonly protocol: typeof KEEL_TRANSFER_RULES_PROTOCOL;
  readonly collection: Address;
  readonly creatorToken:
    | { readonly status: "not-creator-token" }
    | { readonly status: "no-validator" }
    | {
        readonly status: "validated";
        readonly validator: Address;
        readonly version: "v3" | "v5" | "custom";
        readonly policy?:
          | { readonly kind: "v3-level"; readonly level: number; readonly title: string; readonly detail: string; readonly listId: string; readonly authorizationModeDisabled: boolean; readonly wildcardOperatorsDisabled: boolean; readonly accountFreezing: boolean }
          | { readonly kind: "v5-ruleset"; readonly rulesetId: number; readonly title: string; readonly detail: string; readonly listId: string; readonly customRuleset?: Address; readonly globalOptions: number; readonly rulesetOptions: number };
        readonly blocked: readonly KeelOperatorEntry[];
        readonly allowed: readonly KeelOperatorEntry[];
        readonly authorizers: readonly KeelOperatorEntry[];
        readonly frozen: readonly Address[];
        readonly blockedCodeHashes: readonly Hex[];
        readonly allowedCodeHashes: readonly Hex[];
      };
  readonly operatorFilter:
    | { readonly status: "not-registered" }
    | { readonly status: "unavailable" }
    | { readonly status: "registered"; readonly subscription?: Address; readonly subscribedToOpenSeaDefault: boolean; readonly filtered: readonly KeelOperatorEntry[] };
}

const ZERO = /^0x0{40}$/iu;
async function attempt<T>(read: () => Promise<T>): Promise<T | undefined> {
  try { return await read(); } catch { return undefined; }
}
const named = (addresses: readonly unknown[] | undefined): KeelOperatorEntry[] => (addresses ?? []).map((value) => {
  const address = getAddress(String(value));
  const name = KNOWN_TRANSFER_OPERATORS[address.toLowerCase()];
  return name ? { address, name } : { address };
});

async function readValidator(reader: KeelTransferRulesReader, collection: Address, validator: Address): Promise<Extract<KeelTransferRules["creatorToken"], { status: "validated" }>> {
  const read = (abi: readonly unknown[], functionName: string, args: readonly unknown[]) => attempt(() => reader.readContract({ address: validator, abi, functionName, args }));
  // Probe by behaviour: v5 answers getListAccountsByCollection; v3 answers getBlacklistedAccountsByCollection.
  const v5Blocked = await read(transferValidatorV5Abi, "getListAccountsByCollection", [collection, LIST_TYPE.blocked]);
  if (Array.isArray(v5Blocked)) {
    const [policy, allowed, authorizers, frozen, blockedHashes, allowedHashes] = await Promise.all([
      read(transferValidatorV5Abi, "getCollectionSecurityPolicy", [collection]) as Promise<{ rulesetId: number; listId: bigint; customRuleset: Address; globalOptions: number; rulesetOptions: number } | undefined>,
      read(transferValidatorV5Abi, "getListAccountsByCollection", [collection, LIST_TYPE.allowed]),
      read(transferValidatorV5Abi, "getListAccountsByCollection", [collection, LIST_TYPE.authorizers]),
      read(transferValidatorV5Abi, "getFrozenAccountsByCollection", [collection]),
      read(transferValidatorV5Abi, "getListCodeHashesByCollection", [collection, LIST_TYPE.blocked]),
      read(transferValidatorV5Abi, "getListCodeHashesByCollection", [collection, LIST_TYPE.allowed]),
    ]);
    const ruleset = policy ? (V5_RULESETS[Number(policy.rulesetId)] ?? { title: `Ruleset ${policy.rulesetId}`, detail: "A ruleset this version of KEEL does not describe yet." }) : undefined;
    return {
      status: "validated", validator, version: "v5",
      ...(policy && ruleset ? { policy: { kind: "v5-ruleset" as const, rulesetId: Number(policy.rulesetId), ...ruleset, listId: BigInt(policy.listId).toString(), ...(ZERO.test(policy.customRuleset) ? {} : { customRuleset: getAddress(policy.customRuleset) }), globalOptions: Number(policy.globalOptions), rulesetOptions: Number(policy.rulesetOptions) } } : {}),
      blocked: named(v5Blocked), allowed: named(allowed as unknown[] | undefined), authorizers: named(authorizers as unknown[] | undefined),
      frozen: ((frozen as unknown[] | undefined) ?? []).map((value) => getAddress(String(value))),
      blockedCodeHashes: (blockedHashes as Hex[] | undefined) ?? [], allowedCodeHashes: (allowedHashes as Hex[] | undefined) ?? [],
    };
  }
  const v3Blocked = await read(transferValidatorV3Abi, "getBlacklistedAccountsByCollection", [collection]);
  if (Array.isArray(v3Blocked)) {
    const [policy, allowed, authorizers, frozen, blockedHashes, allowedHashes] = await Promise.all([
      read(transferValidatorV3Abi, "getCollectionSecurityPolicy", [collection]) as Promise<{ disableAuthorizationMode: boolean; authorizersCannotSetWildcardOperators: boolean; transferSecurityLevel: number; listId: bigint; enableAccountFreezingMode: boolean } | undefined>,
      read(transferValidatorV3Abi, "getWhitelistedAccountsByCollection", [collection]),
      read(transferValidatorV3Abi, "getAuthorizerAccountsByCollection", [collection]),
      read(transferValidatorV3Abi, "getFrozenAccountsByCollection", [collection]),
      read(transferValidatorV3Abi, "getBlacklistedCodeHashesByCollection", [collection]),
      read(transferValidatorV3Abi, "getWhitelistedCodeHashesByCollection", [collection]),
    ]);
    const level = policy ? V3_SECURITY_LEVELS[Number(policy.transferSecurityLevel)] : undefined;
    return {
      status: "validated", validator, version: "v3",
      ...(policy ? { policy: { kind: "v3-level" as const, level: Number(policy.transferSecurityLevel), title: level?.title ?? `Level ${policy.transferSecurityLevel}`, detail: level?.detail ?? "", listId: BigInt(policy.listId).toString(), authorizationModeDisabled: policy.disableAuthorizationMode, wildcardOperatorsDisabled: policy.authorizersCannotSetWildcardOperators, accountFreezing: policy.enableAccountFreezingMode } } : {}),
      blocked: named(v3Blocked), allowed: named(allowed as unknown[] | undefined), authorizers: named(authorizers as unknown[] | undefined),
      frozen: ((frozen as unknown[] | undefined) ?? []).map((value) => getAddress(String(value))),
      blockedCodeHashes: (blockedHashes as Hex[] | undefined) ?? [], allowedCodeHashes: (allowedHashes as Hex[] | undefined) ?? [],
    };
  }
  return { status: "validated", validator, version: "custom", blocked: [], allowed: [], authorizers: [], frozen: [], blockedCodeHashes: [], allowedCodeHashes: [] };
}

/** Reads a collection's creator-token validator policy and its operator-filter registration. */
export async function readKeelTransferRules(reader: KeelTransferRulesReader, input: { readonly collection: string; readonly checkOperatorFilter?: boolean }): Promise<KeelTransferRules> {
  const collection = getAddress(input.collection);
  const validator = await attempt(() => reader.readContract({ address: collection, abi: creatorTokenAbi, functionName: "getTransferValidator" }));
  const creatorToken: KeelTransferRules["creatorToken"] = typeof validator !== "string"
    ? { status: "not-creator-token" }
    : ZERO.test(validator)
      ? { status: "no-validator" }
      : await readValidator(reader, collection, getAddress(validator));
  let operatorFilter: KeelTransferRules["operatorFilter"] = { status: "not-registered" };
  if (input.checkOperatorFilter !== false) {
    const registered = await attempt(() => reader.readContract({ address: OPERATOR_FILTER_REGISTRY, abi: operatorFilterRegistryAbi, functionName: "isRegistered", args: [collection] }));
    if (registered === undefined) operatorFilter = { status: "unavailable" };
    else if (registered === true) {
      const [subscription, filtered] = await Promise.all([
        attempt(() => reader.readContract({ address: OPERATOR_FILTER_REGISTRY, abi: operatorFilterRegistryAbi, functionName: "subscriptionOf", args: [collection] })),
        attempt(() => reader.readContract({ address: OPERATOR_FILTER_REGISTRY, abi: operatorFilterRegistryAbi, functionName: "filteredOperators", args: [collection] })),
      ]);
      const subscribed = typeof subscription === "string" && !ZERO.test(subscription) ? getAddress(subscription) : undefined;
      operatorFilter = { status: "registered", ...(subscribed ? { subscription: subscribed } : {}), subscribedToOpenSeaDefault: subscribed === OPENSEA_DEFAULT_FILTER_SUBSCRIPTION, filtered: named(filtered as unknown[] | undefined) };
    }
  }
  return { protocol: KEEL_TRANSFER_RULES_PROTOCOL, collection, creatorToken, operatorFilter };
}

/** A change to trading rules, as one exact call for the wallet review flow. */
export interface KeelTransferRuleCall {
  readonly title: string;
  readonly detail: string;
  readonly address: Address;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args: readonly unknown[];
}

const accounts = (list: readonly string[]) => {
  if (!list.length || list.length > 200) throw new TypeError("Choose 1–200 addresses.");
  return list.map((value) => getAddress(value));
};

export type KeelTransferRuleChange =
  | { readonly kind: "set-validator"; readonly collection: string; readonly validator: string }
  | { readonly kind: "v3-set-level"; readonly validator: string; readonly collection: string; readonly level: number; readonly disableAuthorizationMode?: boolean; readonly disableWildcardOperators?: boolean; readonly enableAccountFreezing?: boolean }
  | { readonly kind: "v5-set-ruleset"; readonly validator: string; readonly collection: string; readonly rulesetId: number; readonly customRuleset?: string; readonly globalOptions?: number; readonly rulesetOptions?: number }
  | { readonly kind: "apply-list"; readonly version: "v3" | "v5"; readonly validator: string; readonly collection: string; readonly listId: string }
  | { readonly kind: "create-list"; readonly version: "v3" | "v5"; readonly validator: string; readonly name: string; readonly copyFrom?: string }
  | { readonly kind: "list-accounts"; readonly version: "v3" | "v5"; readonly validator: string; readonly listId: string; readonly list: "blocked" | "allowed"; readonly action: "add" | "remove"; readonly accounts: readonly string[] }
  | { readonly kind: "freeze-accounts"; readonly version: "v3" | "v5"; readonly validator: string; readonly collection: string; readonly action: "freeze" | "unfreeze"; readonly accounts: readonly string[] }
  | { readonly kind: "operator-filter"; readonly collection: string; readonly operator: string; readonly filtered: boolean }
  | { readonly kind: "operator-filter-subscription"; readonly collection: string; readonly subscription?: string; readonly copyExistingEntries?: boolean };

/** Builds the exact call for one change. The wallet shows it; nothing is sent here. */
export function prepareKeelTransferRuleChange(change: KeelTransferRuleChange): KeelTransferRuleCall {
  switch (change.kind) {
    case "set-validator":
      return { title: "Change transfer validator", detail: "The collection will ask this validator to approve every transfer.", address: getAddress(change.collection), abi: creatorTokenAbi, functionName: "setTransferValidator", args: [getAddress(change.validator)] };
    case "v3-set-level": {
      const level = V3_SECURITY_LEVELS[change.level];
      if (!level) throw new RangeError("Choose a security level from 0 to 9.");
      return { title: `Set trading rules: ${level.title}`, detail: level.detail, address: getAddress(change.validator), abi: transferValidatorV3Abi, functionName: "setTransferSecurityLevelOfCollection", args: [getAddress(change.collection), change.level, change.disableAuthorizationMode ?? false, change.disableWildcardOperators ?? false, change.enableAccountFreezing ?? false] };
    }
    case "v5-set-ruleset": {
      const ruleset = V5_RULESETS[change.rulesetId];
      if (!ruleset) throw new RangeError("Choose a known ruleset.");
      if (change.rulesetId === 255 && !change.customRuleset) throw new TypeError("A custom ruleset needs its contract address.");
      return { title: `Set trading rules: ${ruleset.title}`, detail: ruleset.detail, address: getAddress(change.validator), abi: transferValidatorV5Abi, functionName: "setRulesetOfCollection", args: [getAddress(change.collection), change.rulesetId, getAddress(change.customRuleset ?? "0x0000000000000000000000000000000000000000"), change.globalOptions ?? 0, change.rulesetOptions ?? 0] };
    }
    case "apply-list":
      return { title: `Use list #${change.listId}`, detail: "The collection's allowed and blocked marketplaces will come from this list.", address: getAddress(change.validator), abi: change.version === "v5" ? transferValidatorV5Abi : transferValidatorV3Abi, functionName: "applyListToCollection", args: [getAddress(change.collection), BigInt(change.listId)] };
    case "create-list": {
      const name = change.name.trim();
      if (!name || name.length > 64) throw new TypeError("Name the list (up to 64 characters).");
      return change.copyFrom === undefined
        ? { title: `Create list "${name}"`, detail: "You will own the new list and can add marketplaces to it.", address: getAddress(change.validator), abi: change.version === "v5" ? transferValidatorV5Abi : transferValidatorV3Abi, functionName: "createList", args: [name] }
        : { title: `Copy list #${change.copyFrom} as "${name}"`, detail: "Starts from an existing list you can then edit.", address: getAddress(change.validator), abi: change.version === "v5" ? transferValidatorV5Abi : transferValidatorV3Abi, functionName: "createListCopy", args: [name, BigInt(change.copyFrom)] };
    }
    case "list-accounts": {
      const list = accounts(change.accounts);
      const verb = change.action === "add" ? "Add to" : "Remove from";
      if (change.version === "v5") return { title: `${verb} ${change.list} list #${change.listId}`, detail: `${list.length} address${list.length === 1 ? "" : "es"}.`, address: getAddress(change.validator), abi: transferValidatorV5Abi, functionName: change.action === "add" ? "addAccountsToList" : "removeAccountsFromList", args: [BigInt(change.listId), LIST_TYPE[change.list], list] };
      const fn = `${change.action === "add" ? "addAccountsTo" : "removeAccountsFrom"}${change.list === "blocked" ? "Blacklist" : "Whitelist"}`;
      return { title: `${verb} ${change.list} list #${change.listId}`, detail: `${list.length} address${list.length === 1 ? "" : "es"}.`, address: getAddress(change.validator), abi: transferValidatorV3Abi, functionName: fn, args: [BigInt(change.listId), list] };
    }
    case "freeze-accounts": {
      const list = accounts(change.accounts);
      return { title: change.action === "freeze" ? "Freeze accounts" : "Unfreeze accounts", detail: change.action === "freeze" ? "Frozen accounts can't move this collection's tokens." : "These accounts can move tokens again.", address: getAddress(change.validator), abi: change.version === "v5" ? transferValidatorV5Abi : transferValidatorV3Abi, functionName: change.action === "freeze" ? "freezeAccountsForCollection" : "unfreezeAccountsForCollection", args: [getAddress(change.collection), list] };
    }
    case "operator-filter":
      return { title: change.filtered ? "Block a marketplace in the operator filter" : "Allow a marketplace in the operator filter", detail: KNOWN_TRANSFER_OPERATORS[getAddress(change.operator).toLowerCase()] ?? getAddress(change.operator), address: OPERATOR_FILTER_REGISTRY, abi: operatorFilterRegistryAbi, functionName: "updateOperator", args: [getAddress(change.collection), getAddress(change.operator), change.filtered] };
    case "operator-filter-subscription":
      return change.subscription
        ? { title: "Follow another operator filter list", detail: getAddress(change.subscription) === OPENSEA_DEFAULT_FILTER_SUBSCRIPTION ? "OpenSea's default list." : getAddress(change.subscription), address: OPERATOR_FILTER_REGISTRY, abi: operatorFilterRegistryAbi, functionName: "subscribe", args: [getAddress(change.collection), getAddress(change.subscription)] }
        : { title: "Stop following a shared operator filter list", detail: change.copyExistingEntries ? "Keeps a copy of the entries as your own list." : "Starts from an empty list.", address: OPERATOR_FILTER_REGISTRY, abi: operatorFilterRegistryAbi, functionName: "unsubscribe", args: [getAddress(change.collection), change.copyExistingEntries ?? true] };
  }
}

/** One plain-language line for lists and agents. */
export function describeKeelTransferRules(rules: KeelTransferRules): string {
  const parts: string[] = [];
  const token = rules.creatorToken;
  if (token.status === "validated") parts.push(`Creator token (${token.version === "custom" ? "custom validator" : `validator ${token.version}`})${token.policy ? `: ${token.policy.title}` : ""}${token.blocked.length ? ` · ${token.blocked.length} blocked` : ""}${token.allowed.length ? ` · ${token.allowed.length} allowed` : ""}`);
  else if (token.status === "no-validator") parts.push("Creator token with no validator set (transfers are unrestricted)");
  if (rules.operatorFilter.status === "registered") parts.push(rules.operatorFilter.subscribedToOpenSeaDefault ? "Follows OpenSea's operator filter" : `Operator filter: ${rules.operatorFilter.filtered.length} filtered`);
  return parts.join(" · ") || "No on-chain trading rules";
}
