import { keccak256, stringToHex, numberToHex, getAddress, encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

export type KeelSetupCall = { readonly to: Address; readonly data: Hex; readonly value: Hex };
/** No signer, deployment, delegation or serial-transaction fallback is performed here. */
export function buildKeelCreatorSetupBatch(input: {chainId: number; owner: Address; calls: readonly KeelSetupCall[]}) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("Invalid setup chain.");
  const from = getAddress(input.owner);
  if (input.calls.length === 0 || input.calls.length > 32) throw new TypeError("Setup requires 1 to 32 calls.");
  const calls = input.calls.map(call => {
    if (!/^0x(?:[a-f0-9]{2})*$/iu.test(call.data) || !/^0x(?:0|[1-9a-f][a-f0-9]*)$/iu.test(call.value)) throw new TypeError("Invalid setup calldata or value.");
    return {to: getAddress(call.to), data: call.data.toLowerCase() as Hex, value: call.value.toLowerCase() as Hex};
  });
  const chainId = numberToHex(input.chainId);
  const planDigest = keccak256(stringToHex(JSON.stringify({chainId, from, calls})));
  return {schema: "keel.creator-setup-wallet@1" as const, planDigest, chainId: input.chainId, owner: from, calls,
    walletRequest: {method: "wallet_sendCalls" as const, params: [{version: "2.0.0" as const, from, chainId, atomicRequired: true as const, calls}] as const},
    signing: "not-performed" as const, submission: "not-performed" as const};
}
/** EIP-5792 capabilities are scoped to the selected chain; absent means unsupported. */
export function keelAtomicSetupCapability(capabilities: unknown, chainId: number): "supported" | "ready" | "unsupported" {
  const row = (capabilities as Record<string, {atomic?: {status?: string}}> | null)?.[numberToHex(chainId)] ?? (capabilities as Record<string, {atomic?: {status?: string}}> | null)?.[String(chainId)];
  return row?.atomic?.status === "supported" || row?.atomic?.status === "ready" ? row.atomic.status : "unsupported";
}


/** Existing MetaMask account/manager profile. No deployment or delegation is installed. */
export const KEEL_METAMASK_SETUP_PROFILE = {
 chainId:11155111, delegate:"0x63c0c19a282a1b52b07dd5a65b58948a07dae32b" as Address,
 delegateRuntimeHash:"0x9270f73d98e7ed6978677bf0550038289efd510e67e700d024502d62510fc1e4" as Hex,
 manager:"0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3" as Address,
 managerRuntimeHash:"0x49c7f94924ffb53300b7e8ee613814d5ba587fd886177f1e72b3203bf17da673" as Hex,
} as const;
/** Combine logical settings into one external wallet call. Empty delegations
 * make the existing manager execute ONLY msg.sender's account. No extra signer,
 * authority or permissive execution mode is introduced. */
export function buildKeelCreatorSetupManagerBatch(plan:ReturnType<typeof buildKeelCreatorSetupBatch>, observed:{accountCode:Hex;delegateRuntimeHash:Hex;manager:Address;managerRuntimeHash:Hex}) {
 const p=KEEL_METAMASK_SETUP_PROFILE;
 if(plan.chainId!==p.chainId||observed.accountCode.toLowerCase()!=="0xef0100"+p.delegate.slice(2)||observed.delegateRuntimeHash!==p.delegateRuntimeHash||observed.manager.toLowerCase()!==p.manager.toLowerCase()||observed.managerRuntimeHash!==p.managerRuntimeHash)throw TypeError("Existing wallet account/manager profile is not qualified.");
 const expected=buildKeelCreatorSetupBatch({chainId:plan.chainId,owner:plan.owner,calls:plan.calls});if(expected.planDigest!==plan.planDigest)throw TypeError("Setup settings differ from their commitment.");
 const mode=("0x01"+"00".repeat(31)) as Hex;
 const context=encodeAbiParameters([{type:"tuple[]",components:[{name:"delegate",type:"address"},{name:"delegator",type:"address"},{name:"authority",type:"bytes32"},{name:"caveats",type:"tuple[]",components:[{name:"enforcer",type:"address"},{name:"terms",type:"bytes"},{name:"args",type:"bytes"}]},{name:"salt",type:"uint256"},{name:"signature",type:"bytes"}]}],[[]]);
 const execution=encodeAbiParameters([{type:"tuple[]",components:[{name:"target",type:"address"},{name:"value",type:"uint256"},{name:"callData",type:"bytes"}]}],[plan.calls.map(call=>({target:call.to,value:BigInt(call.value),callData:call.data}))]);
 const data=encodeFunctionData({abi:parseAbi(["function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)"]),functionName:"redeemDelegations",args:[[context],[mode],[execution]]});
 return {...plan,walletRequest:{method:"wallet_sendCalls" as const,params:[{...plan.walletRequest.params[0],calls:[{to:p.manager,data,value:"0x0" as Hex}] as KeelSetupCall[]}] as const}};
}
