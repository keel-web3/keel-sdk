import { decodeFunctionResult, encodeFunctionData, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import {
  KEEL_CAMPAIGN_CONTROLS_INTERFACE_ID, describeKeelCampaignControls, keelCampaignControlsAbi, keelCampaignControlsFromConfig,
  keelCampaignLimitControls, keelCampaignLimitFields, keelCampaignLimitModes,
} from '@keel/sdk/campaign-controls';
import type { KeelRpcPool } from '@keel/sdk/rpc';
import { mcpRpc } from './rpc-tools.js';
import type { ToolDefinition } from './types.js';

/**
 * Read-only door to a KeelMintGate campaign's limit controls: locked (the default) or
 * adjustable, which limits the creator may still move, and the live terms collectors meet.
 */
const ADDRESS = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' } as const;
const BYTES32 = { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' } as const;
const KEYS = ['chainId', 'rpcUrl', 'controls', 'campaignId', 'account', 'campaign'];
const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));

async function call(pool: KeelRpcPool, to: Address, block: Hex, functionName: string, args: readonly unknown[]): Promise<any> {
  const raw = await pool.request({ method: 'eth_call', params: [{ to, data: encodeFunctionData({ abi: keelCampaignControlsAbi, functionName: functionName as never, args: args as never }) }, block] });
  if (typeof raw !== 'string' || !/^0x[0-9a-f]*$/iu.test(raw)) throw new TypeError(`Invalid ${functionName} read.`);
  return decodeFunctionResult({ abi: keelCampaignControlsAbi, functionName: functionName as never, data: raw as Hex });
}

export const CAMPAIGN_CONTROLS_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: 'keel-campaign-controls',
    description: 'Report whether a KeelMintGate campaign\'s limits are Locked (the default: they can never change) or Adjustable (chosen at creation; the creator may tighten the listed limits within the published terms and collectors see this). Live mode reads the deployed KeelCampaignControls plate at one pinned block: campaignControls (mode, adjustable fields, creator authority) and effectiveLimits (live supply, wallet/transaction limits, window, minted, mintableNow for an optional account). Offline mode classifies supplied campaign terms (customGate, customGateData, accessFlags, gateLogic) against a known plate address. Unit price is never adjustable. Read-only: no keys, signing or submission.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['controls'], properties: {
      chainId: { type: 'integer', minimum: 1 }, rpcUrl: { type: 'string', maxLength: 2048 },
      controls: { ...ADDRESS, description: 'Deployed KeelCampaignControls plate bound to the campaign\'s gate.' },
      campaignId: BYTES32, account: ADDRESS,
      campaign: { type: 'object', additionalProperties: false, required: ['customGate', 'customGateData', 'accessFlags', 'gateLogic'], properties: {
        customGate: ADDRESS, customGateData: { type: 'string', pattern: '^0x(?:[0-9a-fA-F]{2})*$', maxLength: 8194 },
        accessFlags: { type: 'integer', minimum: 0, maximum: 7 }, gateLogic: { type: 'integer', enum: [0, 1] },
      }, description: 'Offline: the campaign\'s own terms, from getCampaign or a draft.' },
    } },
  },
  async run(context, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('keel-campaign-controls needs an object.');
    const v = value as Record<string, any>;
    if (Object.keys(v).some(key => !KEYS.includes(key)) || typeof v.controls !== 'string') throw new TypeError('Supply the controls plate plus campaignId (live) or campaign (offline).');
    const controls = getAddress(v.controls);
    const modes = keelCampaignLimitModes;
    const fieldBounds = keelCampaignLimitControls.map(({ id, label, bound }) => ({ id, label, bound }));
    if (v.campaign !== undefined) {
      const summary = keelCampaignControlsFromConfig({ ...v.campaign, customGate: getAddress(v.campaign.customGate) }, controls);
      return jsonSafe({ schema: 'keel-campaign-controls@1', source: 'offline-terms', controls: summary, modes, fieldBounds,
        verification: 'not-live-verified', signing: 'not-performed', submission: 'not-performed' });
    }
    if (!Number.isSafeInteger(v.chainId) || typeof v.campaignId !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(v.campaignId)) {
      throw new TypeError('Live mode needs chainId and campaignId.');
    }
    const rpc = await mcpRpc(context, { chainId: Number(v.chainId), ...(v.rpcUrl ? { rpcUrl: v.rpcUrl as string } : {}) });
    const chain = await rpc.pool.request({ method: 'eth_chainId' });
    if (typeof chain !== 'string' || Number(BigInt(chain)) !== Number(v.chainId)) throw new TypeError('Selected-chain identity mismatch.');
    const block = await rpc.pool.request({ method: 'eth_blockNumber' });
    if (typeof block !== 'string' || !/^0x[0-9a-f]+$/iu.test(block)) throw new TypeError('RPC returned an invalid head block.');
    if (!(await call(rpc.pool, controls, block as Hex, 'supportsInterface', [KEEL_CAMPAIGN_CONTROLS_INTERFACE_ID]))) {
      throw new TypeError('The address does not report the IKeelCampaignControls interface.');
    }
    const campaignId = v.campaignId as Hex;
    const account = v.account ? getAddress(v.account) : zeroAddress;
    const [adjustable, adjustableMask, authority] = await call(rpc.pool, controls, block as Hex, 'campaignControls', [campaignId]) as [boolean, bigint, Address];
    const limits = await call(rpc.pool, controls, block as Hex, 'effectiveLimits', [campaignId, account]);
    const gate = await call(rpc.pool, controls, block as Hex, 'gate', []) as Address;
    return jsonSafe({
      schema: 'keel-campaign-controls@1', source: 'live', chainId: Number(v.chainId), blockNumber: BigInt(block).toString(), gate, controlsAddress: controls, campaignId,
      controls: describeKeelCampaignControls(adjustable, adjustableMask, authority),
      authority: { creator: authority, alsoAllowed: ['gate CAMPAIGN_ADMIN_ROLE holders', 'live target owner or DEFAULT_ADMIN_ROLE holders'] },
      effectiveLimits: { ...limits, account, adjustedFields: keelCampaignLimitFields(limits.overriddenMask) },
      notes: ['mintableNow excludes Merkle allowances and signed authorization quotas.', 'Unit price is never adjustable through the controls plate.'],
      modes, fieldBounds, signing: 'not-performed', submission: 'not-performed',
    });
  },
}];
