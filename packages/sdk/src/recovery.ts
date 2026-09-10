import { encodeAbiParameters, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, stringToHex, zeroHash, type Address, type Hex, type PublicClient } from "viem";
import { keelAccessGroupsAbi, keelManagerAbi, keelManagerProxyAbi, keelRecoveryGroupsAbi } from "./abi.js";
export const recoveryActionTypes = { RecoveryAction: [{ name: "groupId", type: "bytes32" }, { name: "resource", type: "address" }, { name: "scope", type: "bytes32" }, { name: "actionHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "revision", type: "uint64" }, { name: "deadline", type: "uint64" }] } as const;
export const recoveryAcceptanceTypes = { RecoveryKeyAcceptance: [{ name: "actionDigest", type: "bytes32" }, { name: "signer", type: "address" }] } as const;
const registryAbi = parseAbi(keelRecoveryGroupsAbi), proxyAbi = parseAbi(keelManagerProxyAbi), groupsAbi = parseAbi(keelAccessGroupsAbi), managerAbi = parseAbi(keelManagerAbi);
export const managerRecoveryScope = keccak256(stringToHex("keel.recovery.manager"));
const tag = (text: string) => keccak256(stringToHex(text));
const hash = (types: readonly {
    type: string;
    components?: readonly {
        name: string;
        type: string;
    }[];
}[], values: readonly unknown[]) => keccak256(encodeAbiParameters(types as never, values as never));
export type RecoverySignature = {
    signer: Address;
    signature: Hex;
    digest: Hex;
};
export type RecoveryOperation = {
    kind: "create";
    registry: Address;
    creator: Address;
    salt: Hex;
    members: readonly Address[];
    verifyKeys: boolean;
} | {
    kind: "rotate";
    registry: Address;
    groupId: Hex;
    members: readonly Address[];
    verifyKeys: boolean;
} | {
    kind: "assign";
    resource: Address;
    resourceKind: "manager" | "group";
    scope?: Hex;
    nextGroup: Hex;
} | {
    kind: "manager";
    resource: Address;
    members: readonly Address[];
} | {
    kind: "group";
    resource: Address;
    scope: Hex;
    members: readonly Address[];
    grants: readonly {
        target: Address;
        selector: Hex;
    }[];
} | {
    kind: "upgrade";
    resource: Address;
    implementation: Address;
    initializer: Hex;
};
const sortedMembers = (members: readonly Address[]) => {
    const out = members.map((member) => getAddress(member)).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    if (out.length === 0 || out.length === 2 || out.some((m, i) => BigInt(m) === 0n || m === out[i - 1]))
        throw Error("Use one backup signer or at least three unique signers.");
    return out;
};
function approval(domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
}, groupId: Hex, resource: Address, scope: Hex, actionHash: Hex, nonce: bigint, revision: bigint, deadline: bigint, members: readonly Address[], threshold: bigint, role: string) {
    const typedData = { domain, types: recoveryActionTypes, primaryType: "RecoveryAction", message: { groupId, resource, scope, actionHash, nonce, revision, deadline } } as const;
    return { role, members, threshold, typedData, digest: hashTypedData(typedData) };
}
function acceptance(domain: ReturnType<typeof approval>["typedData"]["domain"], digest: Hex, signer: Address) {
    const typedData = { domain, types: recoveryAcceptanceTypes, primaryType: "RecoveryKeyAcceptance", message: { actionDigest: digest, signer } } as const;
    return { role: "acceptance", members: [signer] as readonly Address[], threshold: 1n, typedData, digest: hashTypedData(typedData) };
}
export type RecoveryRequest = ReturnType<typeof approval> | ReturnType<typeof acceptance>;
/** One chain snapshot, no signing, no key generation and no automatic submission. */
export async function prepareKeelRecovery(client: PublicClient, operation: RecoveryOperation, expectedChainId: number, deadline?: bigint) {
    const [block, chainId] = await Promise.all([client.getBlock({ blockTag: "latest" }), client.getChainId()]);
    if (chainId !== expectedChainId)
        throw Error("The connected chain does not match the selected chain.");
    if (block.number === null)
        throw Error("A confirmed block is required.");
    const expires = deadline ?? block.timestamp + 3600n;
    if (expires <= block.timestamp || expires >= (1n << 64n))
        throw Error("Choose a future uint64 deadline.");
    const blockNumber = block.number;
    const operationCopy = { ...operation };
    if ("members" in operationCopy)
        operationCopy.members = sortedMembers(operationCopy.members);
    if (operationCopy.kind === "manager" && (operationCopy.members.length < 3 || operationCopy.members.length > 32))
        throw Error("A manager needs 3–32 governors.");
    if (operationCopy.kind === "group") {
        operationCopy.grants = operationCopy.grants.map(g => ({ target: getAddress(g.target), selector: g.selector })).sort((a, b) => (a.target.toLowerCase() + a.selector.slice(2)) < (b.target.toLowerCase() + b.selector.slice(2)) ? -1 : 1);
        if (operationCopy.grants.some((g, i) => !/^0x[0-9a-fA-F]{8}$/.test(g.selector) || g.selector === "0x00000000" || (i > 0 && g.target === operationCopy.grants[i - 1]?.target && g.selector === operationCopy.grants[i - 1]?.selector)))
            throw Error("Use unique contract/function grants.");
    }
    const op = operationCopy;
    const registry = getAddress("registry" in op ? op.registry : await client.readContract({ address: op.resource, abi: proxyAbi, functionName: "recoveryGroups", blockNumber }));
    const domain = { name: "KEEL Recovery Groups", version: "1", chainId, verifyingContract: registry };
    const read = <T>(name: string, args: readonly unknown[]) => client.readContract({ address: registry, abi: registryAbi, functionName: name, args, blockNumber } as never) as Promise<T>;
    const requests: RecoveryRequest[] = [];
    const group = async (id: Hex) => read<readonly [
        readonly Address[],
        bigint,
        bigint,
        bigint,
        boolean,
        boolean
    ]>("group", [id]);
    const action = async (id: Hex, resource: Address, scope: Hex, actionHash: Hex, role: string, allowNew = false) => {
        const [members, threshold, nonce, revision] = await group(id);
        if (!allowNew && revision === 0n)
            throw Error("Recovery group does not exist.");
        const r = approval(domain, id, resource, scope, actionHash, nonce, revision, expires, members, threshold, role);
        const actual = await read<Hex>("actionDigest", [id, resource, scope, actionHash, expires]);
        if (actual.toLowerCase() !== r.digest.toLowerCase())
            throw Error("Recovery signing schema does not match the deployed contract.");
        return r;
    };
    let initialEnrollment = false, bindingRevision = 0n, groupId: Hex = zeroHash;
    if (op.kind === "create" || op.kind === "rotate") {
        groupId = op.kind === "create" ? hash([{ type: "address" }, { type: "bytes32" }], [getAddress(op.creator), op.salt]) : op.groupId;
        const state = await group(groupId);
        if (op.kind === "create" && state[3] !== 0n)
            throw Error("This recovery-group salt has already been used.");
        if (state[5] && op.members.length < 3)
            throw Error("An activated quorum cannot return to one signer.");
        const actionHash = hash([{ type: "bytes32" }, { type: "bytes32" }, { type: "bool" }], [tag("keel.recovery.roster"), hash([{ type: "address[]" }], [op.members]), op.verifyKeys]);
        const r = await action(groupId, registry, groupId, actionHash, "current", op.kind === "create");
        if (op.kind === "rotate")
            requests.push(r);
        if (op.verifyKeys || state[4])
            requests.push(...op.members.map(m => acceptance(domain, r.digest, m)));
    }
    else {
        const scope = op.kind === "group" ? op.scope : op.kind === "assign" && op.resourceKind === "group" ? op.scope : managerRecoveryScope;
        if (!scope || !/^0x[0-9a-fA-F]{64}$/.test(scope))
            throw Error("A group scope is required.");
        const binding = await read<readonly [
            Hex,
            bigint
        ]>("bindings", [op.resource, scope]);
        groupId = binding[0];
        bindingRevision = binding[1];
        if (op.kind === "assign") {
            if (op.nextGroup.toLowerCase() === groupId.toLowerCase())
                throw Error("This backup assignment is unchanged.");
            const actionHash = hash([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }], [tag("keel.recovery.binding"), op.nextGroup, bindingRevision]);
            initialEnrollment = groupId === zeroHash;
            if (!initialEnrollment)
                requests.push(await action(groupId, op.resource, scope, actionHash, "current"));
            if (op.nextGroup !== zeroHash)
                requests.push(await action(op.nextGroup, op.resource, scope, actionHash, "incoming"));
        }
        else {
            if (groupId === zeroHash)
                throw Error("No backup is assigned to this resource.");
            let actionHash: Hex;
            if (op.kind === "upgrade") {
                const code = await client.getCode({ address: op.implementation, blockNumber });
                if (!code || code === "0x")
                    throw Error("The replacement implementation has no code.");
                const slot = await client.readContract({ address: op.implementation, abi: parseAbi(["function proxiableUUID() view returns (bytes32)"]), functionName: "proxiableUUID", blockNumber });
                if (slot !== "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc")
                    throw Error("The implementation is not UUPS compatible.");
                actionHash = hash([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [tag("keel.recovery.upgrade"), getAddress(op.implementation), keccak256(code), keccak256(op.initializer)]);
            }
            else if (op.kind === "manager")
                actionHash = hash([{ type: "address[]" }], [op.members]);
            else
                actionHash = hash([{ type: "address[]" }, { type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "selector", type: "bytes4" }] }], [op.members, op.grants]);
            const r = await action(groupId, op.resource, scope, hash([{ type: "uint64" }, { type: "bytes32" }], [bindingRevision, actionHash]), "recovery");
            requests.push(r);
            if (op.kind !== "upgrade")
                requests.push(...op.members.map(m => acceptance(domain, r.digest, m)));
        }
    }
    return { operation: op, registry, chainId, blockNumber, deadline: expires, groupId, bindingRevision, initialEnrollment, requests };
}
export type KeelRecoveryPlan = Awaited<ReturnType<typeof prepareKeelRecovery>>;
function signaturesFor(request: Pick<RecoveryRequest, "members" | "threshold" | "digest">, packets: readonly RecoverySignature[]) {
    const members = new Set(request.members.map(m => m.toLowerCase()));
    const signatures = packets.filter(p => p.digest.toLowerCase() === request.digest.toLowerCase()).map(p => ({ signer: getAddress(p.signer), signature: p.signature })).sort((a, b) => BigInt(a.signer) < BigInt(b.signer) ? -1 : 1);
    if (BigInt(signatures.length) < request.threshold || signatures.some((s, i) => !members.has(s.signer.toLowerCase()) || s.signer === signatures[i - 1]?.signer))
        throw Error("Missing quorum, duplicate signer, or signer outside this recovery group.");
    return signatures;
}
/** Verify wallet/contract-wallet signatures before building the submission. */
export async function verifyKeelRecoveryPackets(client: PublicClient, plan: KeelRecoveryPlan, packets: readonly RecoverySignature[]) {
    if (await client.getChainId() !== plan.chainId)
        throw Error("The selected chain changed.");
    for (const request of plan.requests)
        for (const item of signaturesFor(request, packets)) {
            if (!await client.verifyTypedData({ ...request.typedData, address: item.signer, signature: item.signature } as never))
                throw Error("A recovery signature is invalid.");
        }
}
export function buildKeelRecoveryCall(plan: KeelRecoveryPlan, packets: readonly RecoverySignature[]) {
    const op = plan.operation;
    const collect = (role: string) => plan.requests.filter(r => r.role === role).flatMap(r => signaturesFor(r, packets));
    const approvals = collect("recovery"), current = collect("current"), incoming = collect("incoming"), accept = collect("acceptance");
    let target: Address, data: Hex;
    if (op.kind === "create") {
        target = plan.registry;
        data = encodeFunctionData({ abi: registryAbi, functionName: "createGroup", args: [op.salt, op.members, op.verifyKeys, plan.deadline, accept] });
    }
    else if (op.kind === "rotate") {
        target = plan.registry;
        data = encodeFunctionData({ abi: registryAbi, functionName: "rotateGroup", args: [op.groupId, op.members, op.verifyKeys, plan.deadline, current, accept] });
    }
    else if (op.kind === "assign") {
        target = op.resource;
        data = op.resourceKind === "manager" ? encodeFunctionData({ abi: proxyAbi, functionName: "configureBackup", args: [op.nextGroup, plan.bindingRevision, plan.deadline, current, incoming] }) : encodeFunctionData({ abi: groupsAbi, functionName: "configureBackup", args: [op.scope!, op.nextGroup, plan.bindingRevision, plan.deadline, current, incoming] });
    }
    else if (op.kind === "manager") {
        target = op.resource;
        data = encodeFunctionData({ abi: proxyAbi, functionName: "recoverGovernors", args: [op.members, plan.deadline, approvals, accept] });
    }
    else if (op.kind === "group") {
        target = op.resource;
        data = encodeFunctionData({ abi: groupsAbi, functionName: "recoverGroup", args: [op.scope, op.members, op.grants, plan.deadline, approvals, accept] });
    }
    else {
        target = op.resource;
        data = encodeFunctionData({ abi: proxyAbi, functionName: "upgradeWithBackup", args: [op.implementation, op.initializer, plan.deadline, approvals] });
    }
    return { target: getAddress(target), value: 0n, data, authorization: plan.initialEnrollment ? "governance" as const : "recovery" as const };
}
const governanceTypes = { GovernanceAction: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "dataHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "epoch", type: "uint64" }] } as const;
/** Only initial enrollment needs the existing resource manager's normal quorum. */
export async function prepareKeelRecoveryEnrollment(client: PublicClient, plan: KeelRecoveryPlan, packets: readonly RecoverySignature[]) {
    const call = buildKeelRecoveryCall(plan, packets);
    if (!plan.initialEnrollment || plan.operation.kind !== "assign")
        throw Error("Only initial enrollment requires operational governance.");
    const op = plan.operation, block = await client.getBlock({ blockTag: "latest" });
    if (block.number === null || block.timestamp >= plan.deadline || await client.getChainId() !== plan.chainId)
        throw Error("Refresh the enrollment plan.");
    const manager = op.resourceKind === "manager" ? op.resource : await client.readContract({ address: op.resource, abi: groupsAbi, functionName: "manager", blockNumber: block.number });
    const [members, threshold, nonce, epoch] = await Promise.all([
        client.readContract({ address: manager, abi: managerAbi, functionName: "governors", blockNumber: block.number }), client.readContract({ address: manager, abi: managerAbi, functionName: "governanceThreshold", blockNumber: block.number }), client.readContract({ address: manager, abi: managerAbi, functionName: "governanceNonce", blockNumber: block.number }), client.readContract({ address: manager, abi: managerAbi, functionName: "governanceEpoch", blockNumber: block.number })
    ]);
    const typedData = { domain: { name: "Keel Manager", version: "1", chainId: plan.chainId, verifyingContract: manager }, types: governanceTypes, primaryType: "GovernanceAction", message: { target: call.target, value: call.value, dataHash: keccak256(call.data), nonce, deadline: plan.deadline, epoch } } as const;
    const digest = hashTypedData(typedData);
    const actual = await client.readContract({ address: manager, abi: managerAbi, functionName: "governanceActionDigest", args: [call, plan.deadline], blockNumber: block.number });
    if (actual !== digest)
        throw Error("Manager signing schema mismatch.");
    return { manager, call, deadline: plan.deadline, request: { role: "governance", members, threshold, digest, typedData } };
}
export function buildKeelRecoveryEnrollment(plan: Awaited<ReturnType<typeof prepareKeelRecoveryEnrollment>>, packets: readonly RecoverySignature[]) {
    const r = plan.request;
    const signatures = signaturesFor(r, packets);
    return { target: plan.manager, value: 0n, data: encodeFunctionData({ abi: managerAbi, functionName: "executeGovernance", args: [plan.call, plan.deadline, signatures] }) };
}
