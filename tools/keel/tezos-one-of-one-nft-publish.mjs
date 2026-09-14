#!/usr/bin/env node
/**
 * Execute the standard Tezos NFT plan through the Tezos SDK signer.
 *
 * This is intentionally approval-gated. It accepts a Tezos key only at
 * action time, requires the untouched @2 review plan, journals every receipt,
 * and proves the standard OnchFS path plus the KEEL harness path afterward.
 */
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KEEL_TEZOS_PUBLICATION_NETWORK,
  KEEL_TEZOS_PUBLICATION_RPC,
  KeelTezosPublicationAdapter,
  assertTezosAppliedReceipt,
} from "../../packages/sdk/dist/index.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BUNDLE = "/Users/ravonus/.codex/visualizations/2026/09/08/01a07ece-e1bd-76c1-867d-0187e66f986f/keel-tezos-one-of-one-q45-standard-eth-modules-v1";
const DEFAULT_KEY_ENV = "KEEL_TEZOS_SHADOWNET_PRIVATE_KEY";
const DEFAULT_ADDRESS_ENV = "KEEL_TEZOS_SHADOWNET_ADDRESS";

function fail(message) { throw new TypeError(message); }

function valueAfter(flag, argv) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${flag} requires a value.`);
  return value;
}

function assertFlags(argv) {
  const withValues = new Set(["--bundle", "--plan", "--output", "--creator", "--network", "--rpc", "--env-file", "--key-env", "--confirmations", "--timeout-ms"]);
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--resume") continue;
    if (!withValues.has(argv[index])) fail(`Unsupported option: ${argv[index]}`);
    index += 1;
  }
}

async function jsonFile(file) { return JSON.parse(await readFile(file, "utf8")); }

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function readSignerConfig(envFile, keyEnv, addressEnv) {
  let fileValues = {};
  if (envFile !== undefined) {
    const text = await readFile(envFile, "utf8");
    try { fileValues = JSON.parse(text); } catch { fileValues = parseEnvFile(text); }
  }
  const privateKey = process.env[keyEnv] ?? fileValues[keyEnv];
  const configuredAddress = process.env[addressEnv] ?? fileValues[addressEnv];
  if (!privateKey) fail(`No Tezos signer is available in ${keyEnv}${envFile === undefined ? "" : ` or ${envFile}`}.`);
  if (/^0x/u.test(privateKey)) fail(`The configured signer value in ${keyEnv} is an EVM key; a Tezos edsk/spsk key is required.`);
  return { privateKey, configuredAddress };
}

function loadTaquito() {
  const requireFromDesktop = createRequire(path.join(REPO, "apps/desktop/package.json"));
  const taquitoEntry = requireFromDesktop.resolve("@taquito/taquito");
  const taquitoRequire = createRequire(taquitoEntry);
  return {
    TezosToolkit: requireFromDesktop("@taquito/taquito").TezosToolkit,
    InMemorySigner: taquitoRequire("@taquito/signer").InMemorySigner,
  };
}

function replaceBindings(value, bindings) {
  if (Array.isArray(value)) return value.map((item) => replaceBindings(item, bindings));
  if (value && typeof value === "object") {
    if (typeof value.bytes === "string") {
      const encoded = value.bytes.replace(/^0x/u, "");
      if (/^(?:[0-9a-f]{2})*$/iu.test(encoded)) {
        const decoded = Buffer.from(encoded, "hex").toString("utf8");
        const replaced = replaceBindings(decoded, bindings);
        if (replaced !== decoded) return { ...value, bytes: Buffer.from(replaced, "utf8").toString("hex") };
      }
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceBindings(child, bindings)]));
  }
  if (typeof value !== "string") return value;
  return Object.entries(bindings).reduce((result, [name, replacement]) => result.replaceAll(`\${receipt:${name}}`, replacement), value);
}

function bytesResult(value) {
  if (value && typeof value === "object" && typeof value.bytes === "string") return value.bytes.replace(/^0x/u, "").toLowerCase();
  if (value && typeof value === "object" && value.data !== undefined) return bytesResult(value.data);
  throw new Error("Tezos view did not return Micheline bytes.");
}

function stringResult(value) {
  if (value && typeof value === "object" && typeof value.string === "string") return value.string;
  if (value && typeof value === "object" && value.data !== undefined) return stringResult(value.data);
  throw new Error("Tezos view did not return a Micheline string.");
}

function pairLeaves(value) {
  if (value && typeof value === "object" && value.data !== undefined) return pairLeaves(value.data);
  if (value && value.prim === "Pair" && Array.isArray(value.args)) return value.args.flatMap(pairLeaves);
  return [value];
}

function containsBytes(value, expected) {
  if (Array.isArray(value)) return value.some((item) => containsBytes(item, expected));
  if (!value || typeof value !== "object") return false;
  if (typeof value.bytes === "string" && value.bytes.replace(/^0x/u, "").toLowerCase() === expected.replace(/^0x/u, "").toLowerCase()) return true;
  return Object.values(value).some((item) => containsBytes(item, expected));
}

function containsString(value, expected) {
  if (Array.isArray(value)) return value.some((item) => containsString(item, expected));
  if (!value || typeof value !== "object") return false;
  if (value.string === expected) return true;
  return Object.values(value).some((item) => containsString(item, expected));
}

function findMetadataBytes(value, key) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findMetadataBytes(item, key);
      if (result !== undefined) return result;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (value.prim === "Elt" && value.args?.[0]?.string === key && typeof value.args?.[1]?.bytes === "string") return value.args[1].bytes.toLowerCase();
  for (const child of Object.values(value)) {
    const result = findMetadataBytes(child, key);
    if (result !== undefined) return result;
  }
  return undefined;
}

function canonicalJson(value) {
  return JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
    : child);
}

function pair(left, right) { return { prim: "Pair", args: [left, right] }; }

async function publishOperation(tezos, adapter, operation, label, confirmations, timeoutMs) {
  process.stdout.write(`${label}…\n`);
  const handle = operation.kind === "origination"
    ? await tezos.contract.originate({ code: operation.script.code, init: operation.script.storage, balance: operation.balance ?? "0", mutez: true })
    : await tezos.contract.transfer({ to: operation.destination, amount: operation.amount, mutez: true, ...(operation.parameters ? { parameter: operation.parameters } : {}) });
  await handle.confirmation(confirmations, timeoutMs);
  const inclusionLevel = handle.includedInBlock;
  if (!Number.isSafeInteger(inclusionLevel)) throw new Error(`${label} ${handle.hash} was confirmed without an inclusion level.`);
  const block = await tezos.rpc.getBlock({ block: String(inclusionLevel) });
  const receipt = block.operations.flat().find((item) => item.hash === handle.hash);
  if (!receipt) throw new Error(`${label} ${handle.hash} was confirmed but is absent from its inclusion block.`);
  assertTezosAppliedReceipt(receipt, handle.hash);
  const result = { label, hash: handle.hash, kind: operation.kind, level: block.header.level, blockHash: block.hash, ...(handle.contractAddress ? { originatedAddress: handle.contractAddress } : {}), receipt };
  if (operation.kind === "origination" && !handle.contractAddress) throw new Error(`${label} applied without an originated contract address.`);
  process.stdout.write(`${label} applied ${result.hash}${result.originatedAddress ? ` → ${result.originatedAddress}` : ""}\n`);
  return result;
}

async function recoverApplied(tezos, operation, label, prior) {
  if (!prior || typeof prior.hash !== "string" || !Number.isSafeInteger(prior.level)) fail(`${label} resume receipt is incomplete.`);
  const block = await tezos.rpc.getBlock({ block: String(prior.level) });
  const receipt = block.operations.flat().find((item) => item.hash === prior.hash);
  if (!receipt) throw new Error(`Could not find ${label} ${prior.hash} in the recorded block.`);
  assertTezosAppliedReceipt(receipt, prior.hash);
  const content = receipt.contents.find((item) => item.kind === operation.kind);
  if (!content) throw new Error(`Recovered ${label} receipt has no ${operation.kind} content.`);
  if (operation.kind === "origination") {
    const actualAddress = content.metadata?.operation_result?.originated_contracts?.[0];
    if (actualAddress !== prior.originatedAddress) throw new Error(`Recovered ${label} address does not match the journal.`);
  } else if (content.destination !== operation.destination || content.amount !== operation.amount) {
    throw new Error(`Recovered ${label} destination or amount does not match the reviewed operation.`);
  }
  return { ...prior, receipt, blockHash: block.hash };
}

async function journal(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertSharedFoundation(adapter, plan, bundle) {
  const rootBytes = await readFile(path.join(bundle, "canonical-shell.html"));
  const html = Buffer.from(bytesResult(await adapter.view(plan.reuse.hold, "harness_html", { bytes: plan.reuse.harnessId.replace(/^0x/u, "") })), "hex");
  if (!rootBytes.equals(html)) fail("The shared Hold harness no longer matches canonical-shell.html; refusing to publish.");
  return { rootBytes };
}

function operationLabels(stageId, operations) {
  if (stageId === "standard-onchfs-carrier") return operations.map((operation, index) => `onchfs-${String(index + 1).padStart(3, "0")}-${operation.parameters?.entrypoint ?? operation.kind}`);
  if (stageId === "collection-metadata-and-mint") return ["set-collection-minter", "strike-token-1", "set-standard-presentation", "set-standard-token-metadata", "set-token-json", "freeze-token-metadata", "freeze-default-presentation"];
  if (stageId === "index-and-activate") return ["register-standard-collection", "publish-standard-revision", "activate-standard-revision"];
  return operations.map((operation, index) => `${stageId}-${index + 1}-${operation.parameters?.entrypoint ?? operation.kind}`);
}

async function assertFile(adapter, hold, fileCid, expectedBytes, label) {
  const result = await adapter.view(hold, "read_file", { bytes: fileCid.replace(/^0x/u, "") });
  const actual = Buffer.from(bytesResult(pairLeaves(result)[0]), "hex");
  if (!actual.equals(expectedBytes)) fail(`${label} readback does not equal the reviewed bytes.`);
  return actual;
}

async function assertReadback({ adapter, plan, bundle, collection, creator, foundation }) {
  const metadata = await jsonFile(path.join(bundle, "tezos-standard-token-metadata.json"));
  const animationBytes = await readFile(path.join(bundle, "canonical-shell.html"));
  const displayBytes = await readFile(path.join(bundle, "tezos-contracts", "one_of_one_standard_collection", "display.jpg"));
  const metadataBytes = Buffer.from(canonicalJson(metadata), "utf8");
  await assertFile(adapter, plan.reuse.hold, plan.carriers.animation.fileCid, animationBytes, "animation OnchFS file");
  await assertFile(adapter, plan.reuse.hold, plan.carriers.display.fileCid, displayBytes, "display OnchFS file");
  await assertFile(adapter, plan.reuse.hold, plan.carriers.metadata.fileCid, metadataBytes, "token metadata OnchFS file");
  const html = Buffer.from(bytesResult(await adapter.view(plan.reuse.hold, "harness_html", { bytes: plan.reuse.harnessId.replace(/^0x/u, "") })), "hex");
  if (!html.equals(animationBytes)) fail("KEEL harness_html no longer equals the same canonical shell used by animation_url.");

  const tokenMetadata = await adapter.view(collection, "token_metadata", { int: "1" });
  const animationUriHex = Buffer.from(plan.carriers.animation.uri, "utf8").toString("hex");
  const displayUriHex = Buffer.from(plan.carriers.display.uri, "utf8").toString("hex");
  const metadataUriHex = Buffer.from(plan.carriers.metadata.uri, "utf8").toString("hex");
  if (findMetadataBytes(tokenMetadata, "animation_url") !== animationUriHex) fail("FA2 token_metadata.animation_url is not the reviewed standard OnchFS URI.");
  if (findMetadataBytes(tokenMetadata, "artifactUri") !== animationUriHex) fail("FA2 token_metadata.artifactUri is not the reviewed standard OnchFS URI.");
  if (findMetadataBytes(tokenMetadata, "displayUri") !== displayUriHex || findMetadataBytes(tokenMetadata, "thumbnailUri") !== displayUriHex) fail("FA2 display metadata does not point at the reviewed poster carrier.");
  if (findMetadataBytes(tokenMetadata, "") !== metadataUriHex) fail("FA2 empty-key metadata does not point at the reviewed standard JSON carrier.");

  const rawJson = stringResult(await adapter.view(collection, "token_json", { int: "1" }));
  if (canonicalJson(JSON.parse(rawJson)) !== canonicalJson(metadata)) fail("token_json readback differs from the reviewed standard metadata JSON.");
  const balance = await adapter.view(collection, "get_balance", pair({ string: creator }, { int: "1" }));
  if (!containsInt(balance, "1")) fail("FA2 token 1 is not owned by the reviewed creator.");
  const supply = await adapter.view(collection, "total_supply", {});
  if (!containsInt(supply, "1")) fail("FA2 total_supply is not one.");
  const frozen = await adapter.view(collection, "token_metadata_frozen", { int: "1" });
  if (!containsString(frozen, "True") && frozen?.prim !== "True") fail("Token metadata was not frozen after readback.");

  const activeRevision = await adapter.view(plan.reuse.index, "active_revision", pair({ string: collection }, { int: "1" }));
  if (!containsBytes(activeRevision, plan.reuse.canonicalRootDigest) || !containsBytes(activeRevision, animationUriHex)) fail("Index readback does not carry the standard OnchFS route and canonical digest.");
  const controller = await adapter.view(plan.reuse.index, "collection_controller", { string: collection });
  if (!containsString(controller, creator)) fail("Index controller readback is not the creator.");
  return { animationFile: true, displayFile: true, metadataFile: true, exactCanonicalShell: true, standardTokenMetadata: true, tokenJson: true, tokenOwner: creator, index: true, foundation };
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write("Usage: pnpm keel:tezos-one-of-one:nft:publish -- --bundle DIR --plan FILE [--creator tz...] [--env-file FILE] [--resume]\n");
    return;
  }
  assertFlags(argv);
  const bundle = path.resolve(valueAfter("--bundle", argv) ?? DEFAULT_BUNDLE);
  const planPath = path.resolve(valueAfter("--plan", argv) ?? path.join(bundle, "shadow-net-nft-standard-publication-plan.json"));
  const output = path.resolve(valueAfter("--output", argv) ?? path.join(bundle, "shadow-net-nft-standard-publication-receipts.json"));
  const plan = await jsonFile(planPath);
  if (plan.schema !== "keel.tezos.native-nft-publication-plan@2" || plan.status !== "review-only" || plan.signing !== "not-performed" || plan.submission !== "not-performed") fail("Only an untouched standard Tezos NFT @2 review plan can be executed.");
  const network = valueAfter("--network", argv) ?? plan.network.identity ?? KEEL_TEZOS_PUBLICATION_NETWORK;
  const rpc = valueAfter("--rpc", argv) ?? plan.network.rpc ?? KEEL_TEZOS_PUBLICATION_RPC;
  if (network !== KEEL_TEZOS_PUBLICATION_NETWORK || rpc !== KEEL_TEZOS_PUBLICATION_RPC) fail("Refusing publication outside the selected Tezos Shadow Net.");
  const envFileValue = valueAfter("--env-file", argv);
  const envFile = envFileValue === undefined ? undefined : path.resolve(envFileValue);
  const keyEnv = valueAfter("--key-env", argv) ?? DEFAULT_KEY_ENV;
  const signerConfig = await readSignerConfig(envFile, keyEnv, DEFAULT_ADDRESS_ENV);
  const { TezosToolkit, InMemorySigner } = loadTaquito();
  const signer = await InMemorySigner.fromSecretKey(signerConfig.privateKey);
  const tezos = new TezosToolkit(rpc);
  tezos.setProvider({ signer, config: { confirmationPollingTimeoutSecond: 900 } });
  const signerAddress = await signer.publicKeyHash();
  const creator = valueAfter("--creator", argv) ?? plan.expectedSender ?? signerConfig.configuredAddress ?? signerAddress;
  if (creator !== signerAddress) fail(`Signer address ${signerAddress} does not match the reviewed NFT creator.`);
  if (signerConfig.configuredAddress && signerConfig.configuredAddress !== signerAddress) fail("The configured Tezos deployer address does not match the signer.");
  if (plan.expectedSender !== creator) fail("The signer does not match the reviewed plan creator.");
  const confirmations = Number(valueAfter("--confirmations", argv) ?? "1");
  const timeoutMs = Number(valueAfter("--timeout-ms", argv) ?? "900000");
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 10) fail("--confirmations must be an integer from 1 to 10.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 3_600_000) fail("--timeout-ms must be between 60000 and 3600000.");
  const resume = argv.includes("--resume");
  if (!resume) {
    try { await access(output); fail(`Refusing to overwrite an existing publication journal: ${output}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }

  const adapter = new KeelTezosPublicationAdapter({ rpcUrl: rpc, network });
  const preflight = await adapter.preflight(creator);
  if (preflight.balanceMutez === "0") fail("The signer has no Shadow Net balance.");
  const foundation = await assertSharedFoundation(adapter, plan, bundle);
  const previous = resume ? await jsonFile(output) : undefined;
  if (resume && (previous?.status !== "in-progress" || path.resolve(previous.plan) !== planPath || previous.expectedSender !== creator)) fail("--resume requires the matching in-progress standard NFT journal.");
  const state = {
    schema: "keel.tezos.native-nft-publication-receipts@2",
    status: "in-progress",
    plan: planPath,
    network: { identity: network, rpc, chainId: preflight.chainId, preflight },
    expectedSender: creator,
    bindings: { ...plan.reuse },
    operations: resume ? [...previous.operations] : [],
  };
  await journal(output, state);
  const priorOperation = (stage, label) => previous?.operations?.find((item) => item.stage === stage && item.label === label);
  const record = async (stage, label, operation) => {
    const result = await publishOperation(tezos, adapter, operation, label, confirmations, timeoutMs);
    state.operations.push({ stage, ...result });
    await journal(output, state);
    return result;
  };

  const origination = plan.originations.stages[0]?.operations?.find((item) => item.artifact === "nftCollection")?.operation;
  if (!origination) fail("The standard NFT plan has no canonical collection origination.");
  const priorOrigination = priorOperation("originate-collection", "originate-standard-collection");
  const nft = priorOrigination
    ? await recoverApplied(tezos, origination, "originate-standard-collection", priorOrigination)
    : await record("originate-collection", "originate-standard-collection", origination);
  state.bindings.collection = nft.originatedAddress;
  await journal(output, state);

  for (const stage of plan.stages) {
    const labels = operationLabels(stage.id, stage.operations);
    if (labels.length !== stage.operations.length) fail(`Plan stage ${stage.id} labels do not match operations.`);
    let seenMissing = false;
    for (let index = 0; index < stage.operations.length; index += 1) {
      const label = labels[index];
      const operation = replaceBindings(stage.operations[index], state.bindings);
      const prior = priorOperation(stage.id, label);
      if (prior) {
        if (seenMissing) fail(`--resume journal has a gap in ${stage.id}.`);
        await recoverApplied(tezos, operation, label, prior);
      } else {
        seenMissing = true;
        await record(stage.id, label, operation);
      }
    }
  }

  state.readback = await assertReadback({ adapter, plan, bundle, collection: state.bindings.collection, creator, foundation: true });
  state.status = "published-and-read-back";
  await journal(output, state);
  process.stdout.write(`${JSON.stringify({ status: state.status, network, creator, collection: state.bindings.collection, reused: { hold: state.bindings.hold, index: state.bindings.index, harnessId: state.bindings.harnessId }, selectedCarrier: plan.carriers.selected, receipts: state.operations.length, output }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
