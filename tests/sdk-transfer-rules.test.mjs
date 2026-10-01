import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import {
  CREATOR_TOKEN_VALIDATORS,
  OPENSEA_DEFAULT_FILTER_SUBSCRIPTION,
  OPERATOR_FILTER_REGISTRY,
  describeKeelTransferRules,
  prepareKeelTransferRuleChange,
  readKeelTransferRules,
} from "../packages/sdk/dist/transfer-rules.js";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const SEAPORT = "0x0000000000000068F116a894984e2DB1123eB395";
const OTHER = "0x2222222222222222222222222222222222222222";

function reader(handlers) {
  return {
    async readContract({ address, functionName, args }) {
      const handler = handlers[`${address.toLowerCase()}:${functionName}`];
      if (!handler) throw new Error(`revert ${functionName}`);
      return handler(args);
    },
  };
}
const v3 = CREATOR_TOKEN_VALIDATORS.v3.toLowerCase();
const v5 = CREATOR_TOKEN_VALIDATORS.v5.toLowerCase();
const registry = OPERATOR_FILTER_REGISTRY.toLowerCase();
const c = COLLECTION.toLowerCase();

test("v3 creator tokens report their level, lists and frozen accounts with marketplace names", async () => {
  const rules = await readKeelTransferRules(reader({
    [`${c}:getTransferValidator`]: () => CREATOR_TOKEN_VALIDATORS.v3,
    [`${v3}:getBlacklistedAccountsByCollection`]: () => [OTHER],
    [`${v3}:getWhitelistedAccountsByCollection`]: () => [SEAPORT],
    [`${v3}:getAuthorizerAccountsByCollection`]: () => [],
    [`${v3}:getFrozenAccountsByCollection`]: () => [],
    [`${v3}:getBlacklistedCodeHashesByCollection`]: () => [],
    [`${v3}:getWhitelistedCodeHashesByCollection`]: () => [],
    [`${v3}:getCollectionSecurityPolicy`]: () => ({ disableAuthorizationMode: false, authorizersCannotSetWildcardOperators: true, transferSecurityLevel: 3, listId: 7n, enableAccountFreezingMode: false, tokenType: 721 }),
    [`${registry}:isRegistered`]: () => false,
  }), { collection: COLLECTION });
  assert.equal(rules.creatorToken.status, "validated");
  assert.equal(rules.creatorToken.version, "v3");
  assert.equal(rules.creatorToken.policy.title, "Allowed marketplaces only");
  assert.equal(rules.creatorToken.policy.listId, "7");
  assert.deepEqual(rules.creatorToken.allowed, [{ address: SEAPORT, name: "OpenSea Seaport 1.6" }]);
  assert.equal(rules.operatorFilter.status, "not-registered");
  assert.match(describeKeelTransferRules(rules), /validator v3\): Allowed marketplaces only · 1 blocked · 1 allowed/u);
});

test("v5 creator tokens are detected by behaviour and report their ruleset", async () => {
  const rules = await readKeelTransferRules(reader({
    [`${c}:getTransferValidator`]: () => CREATOR_TOKEN_VALIDATORS.v5,
    [`${v5}:getListAccountsByCollection`]: ([, type]) => (type === 0 ? [] : type === 1 ? [SEAPORT] : []),
    [`${v5}:getListCodeHashesByCollection`]: () => [],
    [`${v5}:getFrozenAccountsByCollection`]: () => [],
    [`${v5}:getCollectionSecurityPolicy`]: () => ({ rulesetId: 4, listId: 0n, customRuleset: "0x0000000000000000000000000000000000000000", globalOptions: 0, rulesetOptions: 0, tokenType: 721 }),
    [`${registry}:isRegistered`]: () => true,
    [`${registry}:subscriptionOf`]: () => OPENSEA_DEFAULT_FILTER_SUBSCRIPTION,
    [`${registry}:filteredOperators`]: () => [OTHER],
  }), { collection: COLLECTION });
  assert.equal(rules.creatorToken.version, "v5");
  assert.equal(rules.creatorToken.policy.kind, "v5-ruleset");
  assert.equal(rules.creatorToken.policy.title, "Allowed marketplaces only");
  assert.equal(rules.operatorFilter.subscribedToOpenSeaDefault, true);
  assert.match(describeKeelTransferRules(rules), /Follows OpenSea's operator filter/u);
});

test("ordinary collections and unreachable registries are reported plainly", async () => {
  const rules = await readKeelTransferRules(reader({}), { collection: COLLECTION });
  assert.deepEqual(rules.creatorToken, { status: "not-creator-token" });
  assert.deepEqual(rules.operatorFilter, { status: "unavailable" });
  const none = await readKeelTransferRules(reader({ [`${c}:getTransferValidator`]: () => "0x0000000000000000000000000000000000000000" }), { collection: COLLECTION, checkOperatorFilter: false });
  assert.equal(none.creatorToken.status, "no-validator");
});

test("changes become exact calls that encode against their ABI", () => {
  const calls = [
    prepareKeelTransferRuleChange({ kind: "set-validator", collection: COLLECTION, validator: CREATOR_TOKEN_VALIDATORS.v5 }),
    prepareKeelTransferRuleChange({ kind: "v3-set-level", validator: CREATOR_TOKEN_VALIDATORS.v3, collection: COLLECTION, level: 2 }),
    prepareKeelTransferRuleChange({ kind: "v5-set-ruleset", validator: CREATOR_TOKEN_VALIDATORS.v5, collection: COLLECTION, rulesetId: 3 }),
    prepareKeelTransferRuleChange({ kind: "apply-list", version: "v5", validator: CREATOR_TOKEN_VALIDATORS.v5, collection: COLLECTION, listId: "12" }),
    prepareKeelTransferRuleChange({ kind: "create-list", version: "v3", validator: CREATOR_TOKEN_VALIDATORS.v3, name: "My marketplaces", copyFrom: "0" }),
    prepareKeelTransferRuleChange({ kind: "list-accounts", version: "v3", validator: CREATOR_TOKEN_VALIDATORS.v3, listId: "12", list: "blocked", action: "add", accounts: [OTHER] }),
    prepareKeelTransferRuleChange({ kind: "list-accounts", version: "v5", validator: CREATOR_TOKEN_VALIDATORS.v5, listId: "12", list: "allowed", action: "remove", accounts: [SEAPORT] }),
    prepareKeelTransferRuleChange({ kind: "freeze-accounts", version: "v5", validator: CREATOR_TOKEN_VALIDATORS.v5, collection: COLLECTION, action: "freeze", accounts: [OTHER] }),
    prepareKeelTransferRuleChange({ kind: "operator-filter", collection: COLLECTION, operator: SEAPORT, filtered: true }),
    prepareKeelTransferRuleChange({ kind: "operator-filter-subscription", collection: COLLECTION, subscription: OPENSEA_DEFAULT_FILTER_SUBSCRIPTION }),
  ];
  for (const call of calls) assert.match(encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }), /^0x[0-9a-f]{8}/u, call.functionName);
  assert.equal(calls[5].functionName, "addAccountsToBlacklist");
  assert.equal(calls[6].functionName, "removeAccountsFromList");
  assert.throws(() => prepareKeelTransferRuleChange({ kind: "v3-set-level", validator: CREATOR_TOKEN_VALIDATORS.v3, collection: COLLECTION, level: 12 }));
  assert.throws(() => prepareKeelTransferRuleChange({ kind: "list-accounts", version: "v3", validator: CREATOR_TOKEN_VALIDATORS.v3, listId: "1", list: "allowed", action: "add", accounts: [] }));
});
