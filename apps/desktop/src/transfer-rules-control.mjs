// Routes a trading-rule change from @keel/sdk/transfer-rules through the
// editor's existing contract-control path: unsigned review, simulation at a
// pinned block, then the wallet's own approval. Nothing here signs or sends.
import { getAddress, isAddress, toFunctionSignature } from 'viem';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { CREATOR_TOKEN_VALIDATORS, OPERATOR_FILTER_REGISTRY } from '@keel/sdk/transfer-rules';

// The editor's controls take integers as decimal strings so nothing loses precision on the way.
const controlArg = (value) => typeof value === 'bigint' || typeof value === 'number' ? value.toString() : Array.isArray(value) ? value.map(controlArg) : value;

/** A readable name for the contract a trading-rule change is sent to. */
export function transferRuleTargetName(target, collection, collectionName) {
  const address = getAddress(target);
  if (address === OPERATOR_FILTER_REGISTRY) return 'Operator filter registry';
  if (address === getAddress(collection)) return collectionName || 'This collection';
  if (address === CREATOR_TOKEN_VALIDATORS.v5) return 'Creator token validator v5';
  if (address === CREATOR_TOKEN_VALIDATORS.v3) return 'Creator token validator v3';
  return 'Transfer validator';
}

/**
 * Turns one SDK call ({ address, abi, functionName, args }) into the input the
 * editor's contractReview / contractSimulate / prepareWalletTransaction
 * procedures already accept: a one-method tracked contract for the call
 * target, the exact function signature and string-encoded arguments.
 *
 * @param {{ title: string, detail: string, address: string, abi: readonly any[], functionName: string, args: readonly unknown[] }} call
 * @param {{ chainId: number, collection: string, collectionName?: string }} where
 */
export function transferRuleControl(call, { chainId, collection, collectionName }) {
  const fn = call.abi.find((item) => item.type === 'function' && item.name === call.functionName && item.inputs.length === call.args.length);
  if (!fn) throw new TypeError('This change has no matching contract method.');
  if (fn.stateMutability === 'view' || fn.stateMutability === 'pure') throw new TypeError('Trading-rule changes must be write calls.');
  const contract = createTrackedContract({
    chainId, address: getAddress(call.address), kind: 'default', source: 'sdk-deployment', abi: [fn],
    name: transferRuleTargetName(call.address, collection, collectionName),
    notes: `${call.title}. ${call.detail}`.slice(0, 4000),
  });
  return { contract, signature: toFunctionSignature(fn), args: call.args.map(controlArg), valueWei: '0', title: call.title, detail: call.detail };
}

/** Splits pasted text into addresses and the parts that are not addresses. */
export function parseAccountList(text) {
  const parts = String(text ?? '').split(/[\s,]+/u).map((part) => part.trim()).filter(Boolean);
  return { accounts: [...new Set(parts.filter((part) => isAddress(part, { strict: false })).map((part) => getAddress(part)))], invalid: parts.filter((part) => !isAddress(part, { strict: false })) };
}
