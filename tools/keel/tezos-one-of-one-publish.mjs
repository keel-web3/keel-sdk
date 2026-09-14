#!/usr/bin/env node
/**
 * Execute the prepared KEEL Tezos one-of-one publication plan through the SDK.
 *
 * This is the live counterpart to tezos-one-of-one-plan.mjs.  It uses the
 * Taquito SDK signer that is already installed in this workspace, submits one
 * receipt-bound stage at a time, and stops on the first non-applied receipt.
 * The private key is read only from the named environment variable (or the
 * existing local deployer env file); it is never written to the journal or
 * printed.  No Electron, Beacon bridge, or fabricated KT1 address is used.
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KEEL_TEZOS_PUBLICATION_NETWORK,
  KEEL_TEZOS_PUBLICATION_RPC,
  KeelTezosPublicationAdapter,
  assertTezosAppliedReceipt,
  buildTezosOneOfOneOriginations,
  prepareTezosDependentOriginations,
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
  const withValues = new Set([
    "--bundle", "--plan", "--output", "--creator", "--network", "--rpc",
    "--env-file", "--key-env", "--confirmations", "--timeout-ms",
    "--resume-hold-address", "--resume-hold-hash", "--resume-hold-level",
    "--resume-index-address", "--resume-index-hash", "--resume-index-level",
  ]);
  const withoutValues = new Set(["--resume"]);
  for (let index = 0; index < argv.length; index += 1) {
    if (withoutValues.has(argv[index])) continue;
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
  return Object.entries(bindings).reduce((result, [name, address]) => result.replaceAll(`\${receipt:${name}}`, address), value);
}

function findStage(plan, id) {
  const stage = plan.stages.find((item) => item.id === id);
  if (!stage) fail(`Publication plan is missing stage ${id}.`);
  return stage;
}

function findOrigination(plan, stageId, artifact) {
  const stage = plan.originations.stages.find((item) => item.id === stageId);
  const operation = stage?.operations.find((item) => item.artifact === artifact)?.operation;
  if (!operation) fail(`Publication plan is missing ${stageId}/${artifact} origination.`);
  return operation;
}

function bytesResult(value) {
  if (value && typeof value === "object" && typeof value.bytes === "string") return value.bytes.replace(/^0x/u, "").toLowerCase();
  if (value && typeof value === "object" && value.data !== undefined) return bytesResult(value.data);
  throw new Error("Tezos view did not return a Micheline bytes value.");
}

function containsString(value, expected) {
  if (Array.isArray(value)) return value.some((item) => containsString(item, expected));
  if (!value || typeof value !== "object") return false;
  if (value.string === expected) return true;
  return Object.values(value).some((item) => containsString(item, expected));
}

function containsBytes(value, expected) {
  if (Array.isArray(value)) return value.some((item) => containsBytes(item, expected));
  if (!value || typeof value !== "object") return false;
  if (typeof value.bytes === "string" && value.bytes.replace(/^0x/u, "").toLowerCase() === expected.replace(/^0x/u, "").toLowerCase()) return true;
  return Object.values(value).some((item) => containsBytes(item, expected));
}

function containsTokenBalance(value, owner) {
  if (Array.isArray(value)) return value.some((item) => containsTokenBalance(item, owner));
  if (!value || typeof value !== "object") return false;
  if (value.prim === "Elt" && Array.isArray(value.args) && value.args.length === 2) {
    const key = value.args[0];
    const balance = value.args[1];
    const ownerFound = containsString(key, owner);
    const tokenOne = containsInt(key, "1");
    return ownerFound && tokenOne && balance?.int === "1";
  }
  return Object.values(value).some((item) => containsTokenBalance(item, owner));
}

function containsInt(value, expected) {
  if (Array.isArray(value)) return value.some((item) => containsInt(item, expected));
  if (!value || typeof value !== "object") return false;
  if (value.int === expected) return true;
  return Object.values(value).some((item) => containsInt(item, expected));
}

function pair(left, right) { return { prim: "Pair", args: [left, right] }; }

function loadTaquito() {
  // Taquito is an SDK dependency of the existing workspace wallet package;
  // resolving from that package keeps this publisher independent of Electron.
  const requireFromDesktop = createRequire(path.join(REPO, "apps/desktop/package.json"));
  const taquitoEntry = requireFromDesktop.resolve("@taquito/taquito");
  const taquitoRequire = createRequire(taquitoEntry);
  return {
    TezosToolkit: requireFromDesktop("@taquito/taquito").TezosToolkit,
    InMemorySigner: taquitoRequire("@taquito/signer").InMemorySigner,
  };
}

async function readSignerConfig(envFile, keyEnv, addressEnv) {
  const fileValues = envFile === undefined
    ? {}
    : await jsonFile(envFile).catch(async () => parseEnvFile(await readFile(envFile, "utf8")));
  const privateKey = process.env[keyEnv] ?? fileValues[keyEnv];
  const configuredAddress = process.env[addressEnv] ?? fileValues[addressEnv];
  if (!privateKey) fail(`No Tezos signer is available in ${keyEnv}${envFile === undefined ? "" : ` or ${envFile}`}.`);
  if (/^0x/u.test(privateKey)) fail(`The configured signer value in ${keyEnv} is an EVM key. Supply a Tezos edsk/spsk key or a Tezos signer module.`);
  return { privateKey, configuredAddress };
}

async function publishOperation(tezos, adapter, operation, label, confirmations, timeoutMs) {
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
  const result = {
    label,
    hash: handle.hash,
    kind: operation.kind,
    level: block.header.level,
    blockHash: block.hash,
    ...(handle.contractAddress ? { originatedAddress: handle.contractAddress } : {}),
    receipt,
  };
  if (operation.kind === "origination" && !handle.contractAddress) throw new Error(`${label} applied without an originated contract address.`);
  // The adapter is intentionally used for the same receipt-bound RPC path as
  // the review plan; this also makes a bad RPC response fail closed.
  await adapter.get(`/chains/main/blocks/${block.hash}/header`);
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
    : child);
}

function canonicalScript(script) {
  return canonicalJson({
    ...script,
    // Tezos normalizes top-level parameter/storage/code/view sections when
    // returning an included operation; compare the section multiset, not RPC
    // presentation order.
    code: [...script.code].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  });
}

async function recoverAppliedOrigination(tezos, adapter, operation, label, hash, level, expectedAddress) {
  if (!/^o[1-9A-HJ-NP-Za-km-z]{50}$/u.test(hash)) fail(`${label} resume receipt has an invalid Tezos operation hash.`);
  if (!Number.isSafeInteger(level) || level < 1) fail(`${label} resume receipt has an invalid block level.`);
  const block = await tezos.rpc.getBlock({ block: String(level) });
  const receipt = block.operations.flat().find((item) => item.hash === hash);
  if (!receipt) throw new Error(`Could not find ${label} ${hash} in Shadow Net block ${level}.`);
  assertTezosAppliedReceipt(receipt, hash);
  const content = receipt.contents.find((item) => item.kind === "origination");
  const actualAddress = content?.metadata?.operation_result?.originated_contracts?.[0];
  if (!content || !actualAddress || actualAddress !== expectedAddress) throw new Error(`Recovered ${label} receipt did not originate the expected address.`);
  if (content.balance !== operation.balance || canonicalScript(content.script) !== canonicalScript(operation.script)) throw new Error(`Recovered ${label} receipt does not match the reviewed origination.`);
  await adapter.get(`/chains/main/blocks/${block.hash}/header`);
  return { label, hash, kind: "origination", level: block.header.level, blockHash: block.hash, originatedAddress: actualAddress, receipt };
}

async function recoverAppliedTransaction(tezos, adapter, operation, label, prior) {
  if (!prior || typeof prior.hash !== "string" || !Number.isSafeInteger(prior.level)) fail(`${label} resume receipt is incomplete.`);
  if (!/^o[1-9A-HJ-NP-Za-km-z]{50}$/u.test(prior.hash)) fail(`${label} resume receipt has an invalid Tezos operation hash.`);
  const block = await tezos.rpc.getBlock({ block: String(prior.level) });
  const receipt = block.operations.flat().find((item) => item.hash === prior.hash);
  if (!receipt) throw new Error(`Could not find ${label} ${prior.hash} in Shadow Net block ${prior.level}.`);
  assertTezosAppliedReceipt(receipt, prior.hash);
  const content = receipt.contents.find((item) => item.kind === "transaction");
  if (!content || content.destination !== operation.destination || content.amount !== operation.amount || canonicalJson(content.parameters ?? null) !== canonicalJson(operation.parameters ?? null)) {
    throw new Error(`Recovered ${label} receipt does not match the reviewed transaction.`);
  }
  await adapter.get(`/chains/main/blocks/${block.hash}/header`);
  return { ...prior, label, hash: prior.hash, kind: "transaction", level: block.header.level, blockHash: block.hash, receipt };
}

async function journal(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write("Usage: pnpm keel:tezos-one-of-one:publish -- --bundle DIR --plan FILE [--creator tz...] [--env-file FILE] [--key-env NAME]\n");
    return;
  }
  assertFlags(argv);
  const bundle = path.resolve(valueAfter("--bundle", argv) ?? DEFAULT_BUNDLE);
  const planPath = path.resolve(valueAfter("--plan", argv) ?? path.join(bundle, "shadow-net-publication-plan.json"));
  const output = path.resolve(valueAfter("--output", argv) ?? path.join(bundle, "shadow-net-publication-receipts.json"));
  const envFileValue = valueAfter("--env-file", argv);
  const envFile = envFileValue === undefined ? undefined : path.resolve(envFileValue);
  const keyEnv = valueAfter("--key-env", argv) ?? DEFAULT_KEY_ENV;
  const addressEnv = DEFAULT_ADDRESS_ENV;
  const plan = await jsonFile(planPath);
  if (plan.status !== "review-only" || plan.signing !== "not-performed" || plan.submission !== "not-performed") fail("Only an untouched review-only publication plan can be executed.");
  const network = valueAfter("--network", argv) ?? plan.network.identity ?? KEEL_TEZOS_PUBLICATION_NETWORK;
  const rpc = valueAfter("--rpc", argv) ?? plan.network.rpc ?? KEEL_TEZOS_PUBLICATION_RPC;
  if (network !== KEEL_TEZOS_PUBLICATION_NETWORK) fail(`Refusing publication on unselected Tezos network ${network}.`);
  if (rpc !== KEEL_TEZOS_PUBLICATION_RPC) fail(`Refusing publication through an unselected Tezos RPC ${rpc}.`);
  const signerConfig = await readSignerConfig(envFile, keyEnv, addressEnv);
  const { TezosToolkit, InMemorySigner } = loadTaquito();
  const signer = await InMemorySigner.fromSecretKey(signerConfig.privateKey);
  const tezos = new TezosToolkit(rpc);
  tezos.setProvider({ signer, config: { confirmationPollingTimeoutSecond: 900 } });
  const signerAddress = await signer.publicKeyHash();
  const creator = valueAfter("--creator", argv) ?? plan.expectedSender ?? signerConfig.configuredAddress ?? signerAddress;
  if (creator !== signerAddress) fail(`Signer address ${signerAddress} does not match publication creator ${creator}.`);
  if (signerConfig.configuredAddress && signerConfig.configuredAddress !== signerAddress) fail("The configured deployer address does not match the supplied signer.");
  if (plan.expectedSender !== creator) fail("The publication creator does not match the reviewed plan.");
  const confirmations = Number(valueAfter("--confirmations", argv) ?? "1");
  const timeoutMs = Number(valueAfter("--timeout-ms", argv) ?? "900000");
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 10) fail("--confirmations must be an integer from 1 to 10.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 3_600_000) fail("--timeout-ms must be between 60000 and 3600000.");
  const resumeExisting = argv.includes("--resume");

  const adapter = new KeelTezosPublicationAdapter({ rpcUrl: rpc, network });
  const preflight = await adapter.preflight(creator);
  if (preflight.balanceMutez === "0") fail("Signer has no Shadow Net balance.");
  const artifactRoot = path.join(bundle, "tezos-contracts");
  const artifactNames = ["hold", "index", "shell", "collection"];
  const artifacts = {};
  for (const name of artifactNames) {
    const directory = path.join(artifactRoot, `one_of_one_${name}`);
    artifacts[name] = {
      key: name,
      label: `Keel ${name}`,
      dependency: name === "shell" ? "hold" : name === "collection" ? "index" : undefined,
      script: { code: await jsonFile(path.join(directory, "contract.json")), storage: await jsonFile(path.join(directory, "storage.json")) },
    };
  }
  const originations = buildTezosOneOfOneOriginations({ creator, network, artifacts });
  const previousJournal = resumeExisting ? await jsonFile(output) : undefined;
  if (resumeExisting && (previousJournal?.status !== "in-progress" || path.resolve(previousJournal.plan) !== planPath || previousJournal.expectedSender !== creator)) {
    fail("--resume requires the matching in-progress publication journal.");
  }
  const journalState = {
    schema: "keel.tezos.publication-receipts@1",
    status: "in-progress",
    plan: planPath,
    network: { identity: network, rpc, chainId: preflight.chainId, preflight },
    expectedSender: creator,
    bindings: {},
    operations: resumeExisting ? [...previousJournal.operations] : [],
  };
  await journal(output, journalState);
  const record = async (stage, label, operation) => {
    process.stdout.write(`${stage}: ${label}…\n`);
    const result = await publishOperation(tezos, adapter, operation, label, confirmations, timeoutMs);
    journalState.operations.push({ stage, ...result });
    await journal(output, journalState);
    process.stdout.write(`${stage}: ${label} applied ${result.hash}${result.originatedAddress ? ` → ${result.originatedAddress}` : ""}\n`);
    return result;
  };

  process.stdout.write(`SDK publisher on ${network}; sender ${creator}; head ${preflight.head.level}\n`);
  const holdOperation = findOrigination(plan, "originate-foundation", "hold");
  const resumeHoldAddress = valueAfter("--resume-hold-address", argv);
  const resumeHoldHash = valueAfter("--resume-hold-hash", argv);
  const resumeHoldLevelValue = valueAfter("--resume-hold-level", argv);
  const resumeIndexAddress = valueAfter("--resume-index-address", argv);
  const resumeIndexHash = valueAfter("--resume-index-hash", argv);
  const resumeIndexLevelValue = valueAfter("--resume-index-level", argv);
  const resumeHoldFlags = [resumeHoldAddress, resumeHoldHash, resumeHoldLevelValue].filter((value) => value !== undefined);
  const resumeIndexFlags = [resumeIndexAddress, resumeIndexHash, resumeIndexLevelValue].filter((value) => value !== undefined);
  if (resumeHoldFlags.length !== 0 && resumeHoldFlags.length !== 3) fail("Resume the already-included Hold only with --resume-hold-address, --resume-hold-hash, and --resume-hold-level together.");
  if (resumeIndexFlags.length !== 0 && resumeIndexFlags.length !== 3) fail("Resume the already-included Index only with --resume-index-address, --resume-index-hash, and --resume-index-level together.");
  if (resumeIndexFlags.length !== 0 && resumeHoldFlags.length === 0) fail("Resuming Index requires resuming the already-included Hold too.");
  let foundationHold;
  const priorOperation = (stage, label) => previousJournal?.operations?.find((item) => item.stage === stage && item.label === label);
  if (resumeExisting) {
    const prior = priorOperation("originate-foundation", "hold");
    if (!prior?.originatedAddress) fail("--resume journal is missing the applied Hold origination.");
    foundationHold = await recoverAppliedOrigination(tezos, adapter, holdOperation, "hold", prior.hash, prior.level, prior.originatedAddress);
    journalState.bindings = { hold: foundationHold.originatedAddress };
    process.stdout.write(`originate-foundation: hold resumed ${foundationHold.hash} → ${foundationHold.originatedAddress}\n`);
  } else if (resumeHoldFlags.length === 3) {
    foundationHold = await recoverAppliedOrigination(tezos, adapter, holdOperation, "hold", resumeHoldHash, Number(resumeHoldLevelValue), resumeHoldAddress);
    journalState.operations.push({ stage: "originate-foundation", ...foundationHold });
    journalState.bindings = { hold: foundationHold.originatedAddress };
    await journal(output, journalState);
    process.stdout.write(`originate-foundation: hold recovered ${foundationHold.hash} → ${foundationHold.originatedAddress}\n`);
  } else {
    foundationHold = await record("originate-foundation", "hold", holdOperation);
  }
  const indexOperation = findOrigination(plan, "originate-foundation", "index");
  let foundationIndex;
  if (resumeExisting) {
    const prior = priorOperation("originate-foundation", "index");
    if (!prior?.originatedAddress) fail("--resume journal is missing the applied Index origination.");
    foundationIndex = await recoverAppliedOrigination(tezos, adapter, indexOperation, "index", prior.hash, prior.level, prior.originatedAddress);
    journalState.bindings = { hold: foundationHold.originatedAddress, index: foundationIndex.originatedAddress };
    process.stdout.write(`originate-foundation: index resumed ${foundationIndex.hash} → ${foundationIndex.originatedAddress}\n`);
  } else if (resumeIndexFlags.length === 3) {
    foundationIndex = await recoverAppliedOrigination(tezos, adapter, indexOperation, "index", resumeIndexHash, Number(resumeIndexLevelValue), resumeIndexAddress);
    journalState.operations.push({ stage: "originate-foundation", ...foundationIndex });
    journalState.bindings = { hold: foundationHold.originatedAddress, index: foundationIndex.originatedAddress };
    await journal(output, journalState);
    process.stdout.write(`originate-foundation: index recovered ${foundationIndex.hash} → ${foundationIndex.originatedAddress}\n`);
  } else {
    foundationIndex = await record("originate-foundation", "index", indexOperation);
  }
  const bindings = { hold: foundationHold.originatedAddress, index: foundationIndex.originatedAddress };
  journalState.bindings = { ...bindings };
  await journal(output, journalState);

  const dependent = prepareTezosDependentOriginations({ creator, network, artifacts }, bindings);
  let dependentShell;
  let dependentCollection;
  if (resumeExisting) {
    const priorShell = priorOperation("originate-dependent", "shell");
    const priorCollection = priorOperation("originate-dependent", "collection");
    if (!priorShell?.originatedAddress || !priorCollection?.originatedAddress) fail("--resume journal is missing the applied dependent originations.");
    dependentShell = await recoverAppliedOrigination(tezos, adapter, dependent[0], "shell", priorShell.hash, priorShell.level, priorShell.originatedAddress);
    dependentCollection = await recoverAppliedOrigination(tezos, adapter, dependent[1], "collection", priorCollection.hash, priorCollection.level, priorCollection.originatedAddress);
    process.stdout.write(`originate-dependent: shell resumed ${dependentShell.hash} → ${dependentShell.originatedAddress}\n`);
    process.stdout.write(`originate-dependent: collection resumed ${dependentCollection.hash} → ${dependentCollection.originatedAddress}\n`);
  } else {
    dependentShell = await record("originate-dependent", "shell", dependent[0]);
    dependentCollection = await record("originate-dependent", "collection", dependent[1]);
  }
  Object.assign(bindings, { shell: dependentShell.originatedAddress, collection: dependentCollection.originatedAddress });
  journalState.bindings = { ...bindings };
  await journal(output, journalState);

  const carrier = findStage(plan, "carrier-objects");
  let carrierStart = 0;
  if (resumeExisting) {
    const priorCarrier = journalState.operations.filter((item) => item.stage === "carrier-objects");
    if (priorCarrier.length === 0 || priorCarrier.length > carrier.operations.length) fail("--resume journal has no resumable carrier boundary.");
    for (let index = 0; index < priorCarrier.length; index += 1) {
      const priorLabel = priorCarrier[index].label;
      const match = /^(\d+)\/\d+$/u.exec(priorLabel);
      if (match === null || Number(match[1]) !== index + 1) fail(`--resume carrier journal is not contiguous at carrier ${index + 1}.`);
      const expectedLabel = `${index + 1}/${carrier.operations.length}`;
      await recoverAppliedTransaction(tezos, adapter, replaceBindings(carrier.operations[index], bindings), expectedLabel, priorCarrier[index]);
    }
    carrierStart = priorCarrier.length;
    process.stdout.write(`carrier-objects: resumed ${carrierStart}/${carrier.operations.length}\n`);
  }
  for (let index = carrierStart; index < carrier.operations.length; index += 1) {
    await record("carrier-objects", `${index + 1}/${carrier.operations.length}`, replaceBindings(carrier.operations[index], bindings));
  }

  const configureStage = findStage(plan, "configure-and-forge");
  let forgeOperation;
  if (resumeExisting) {
    const priorConfigure = priorOperation("configure-and-forge", "configure-verifier");
    const priorForge = priorOperation("configure-and-forge", "forge-harness");
    if (!priorConfigure || !priorForge) fail("--resume journal is missing the applied verifier/harness operations.");
    await recoverAppliedTransaction(tezos, adapter, replaceBindings(configureStage.operations[0], bindings), "configure-verifier", priorConfigure);
    forgeOperation = replaceBindings(configureStage.operations[1], bindings);
    await recoverAppliedTransaction(tezos, adapter, forgeOperation, "forge-harness", priorForge);
    process.stdout.write(`configure-and-forge: verifier resumed ${priorConfigure.hash}\n`);
    process.stdout.write(`configure-and-forge: harness resumed ${priorForge.hash}\n`);
  } else {
    await record("configure-and-forge", "configure-verifier", replaceBindings(configureStage.operations[0], bindings));
    forgeOperation = replaceBindings(configureStage.operations[1], bindings);
    await record("configure-and-forge", "forge-harness", forgeOperation);
  }
  const forgeValue = forgeOperation.parameters.value;
  const identity = pair({ string: creator }, forgeValue);
  const predicted = bytesResult(await adapter.view(bindings.hold, "predict_harness_id", identity));
  if (predicted.length !== 64) throw new Error("Shadow Net returned an invalid harness id.");
  bindings.harnessId = `0x${predicted}`;
  journalState.bindings = { ...bindings };
  await journal(output, journalState);
  const harness = await adapter.view(bindings.hold, "get_harness", { bytes: predicted });
  if (!harness) throw new Error("Hold get_harness readback was empty.");
  const rootBytes = new Uint8Array(await readFile(path.join(bundle, "canonical-shell.html")));
  const htmlResult = await adapter.view(bindings.hold, "harness_html", { bytes: predicted });
  const htmlBytes = Buffer.from(bytesResult(htmlResult), "hex");
  if (!Buffer.from(rootBytes).equals(htmlBytes)) throw new Error("On-chain harness_html does not equal canonical-shell.html.");

  const collectionStage = findStage(plan, "collection-and-index");
  const labels = ["register-collection", "set-presentation", "set-minter", "publish-revision", "activate-revision", "strike-1-of-1"];
  if (resumeExisting) {
    const priorRegister = priorOperation("collection-and-index", "register-collection");
    const priorPresentation = priorOperation("collection-and-index", "set-presentation") ?? priorOperation("collection-and-index", "set-presentation-corrected");
    const priorMinter = priorOperation("collection-and-index", "set-minter");
    if (!priorRegister || !priorPresentation || !priorMinter) fail("--resume journal is missing the applied collection setup operations.");
    const correctedRegister = replaceBindings(collectionStage.operations[0], bindings);
    const priorCorrectedRegister = priorOperation("collection-and-index", "register-collection-corrected");
    if (priorCorrectedRegister) {
      await recoverAppliedTransaction(tezos, adapter, correctedRegister, "register-collection-corrected", priorCorrectedRegister);
    } else {
      await record("collection-and-index", "register-collection-corrected", correctedRegister);
    }
    const correctedPresentation = replaceBindings(collectionStage.operations[1], bindings);
    const priorCorrectedPresentation = priorOperation("collection-and-index", "set-presentation-corrected");
    if (priorCorrectedPresentation) {
      await recoverAppliedTransaction(tezos, adapter, correctedPresentation, "set-presentation-corrected", priorCorrectedPresentation);
    } else {
      await record("collection-and-index", "set-presentation-corrected", correctedPresentation);
    }
    await recoverAppliedTransaction(tezos, adapter, replaceBindings(collectionStage.operations[2], bindings), labels[2], priorMinter);
    const correctedPublish = replaceBindings(collectionStage.operations[3], bindings);
    const priorCorrectedPublish = priorOperation("collection-and-index", "publish-revision-corrected");
    if (priorCorrectedPublish) {
      await recoverAppliedTransaction(tezos, adapter, correctedPublish, "publish-revision-corrected", priorCorrectedPublish);
    } else {
      await record("collection-and-index", "publish-revision-corrected", correctedPublish);
    }
    const correctedActivate = replaceBindings(collectionStage.operations[4], bindings);
    const priorCorrectedActivate = priorOperation("collection-and-index", "activate-revision-corrected");
    if (priorCorrectedActivate) {
      await recoverAppliedTransaction(tezos, adapter, correctedActivate, "activate-revision-corrected", priorCorrectedActivate);
    } else {
      await record("collection-and-index", "activate-revision-corrected", correctedActivate);
    }
    const priorStrike = priorOperation("collection-and-index", labels[5]);
    if (!priorStrike) fail("--resume journal is missing the applied 1-of-1 strike.");
    await recoverAppliedTransaction(tezos, adapter, replaceBindings(collectionStage.operations[5], bindings), labels[5], priorStrike);
  } else {
    for (let index = 0; index < collectionStage.operations.length; index += 1) {
      await record("collection-and-index", labels[index], replaceBindings(collectionStage.operations[index], bindings));
    }
  }

  const activeRevisionInput = pair({ string: bindings.collection }, { int: "1" });
  const activeRevision = await adapter.view(bindings.index, "active_revision", activeRevisionInput);
  const expectedManifestUri = Buffer.from(`keel+tezos://${network}/${bindings.hold}/harness/${bindings.harnessId}`, "utf8").toString("hex");
  if (!activeRevision || !containsBytes(activeRevision, plan.artifact.rootIntegrity.digest) || !containsBytes(activeRevision, expectedManifestUri) || !containsInt(activeRevision, "1")) throw new Error("Index active_revision readback did not bind revision 1, the canonical root digest, and the receipt-bound harness URI.");
  const collectionController = await adapter.view(bindings.index, "collection_controller", { string: bindings.collection });
  if (!containsString(collectionController, creator)) throw new Error("Index collection_controller readback did not bind the real collection to the creator controller.");
  const tokenBalance = await adapter.view(bindings.collection, "get_balance", pair({ string: creator }, { int: "1" }));
  if (!containsInt(tokenBalance, "1")) throw new Error("FA2 get_balance readback did not prove token 1 ownership by the creator.");
  const totalSupply = await adapter.view(bindings.collection, "total_supply", { prim: "Unit" });
  if (!containsInt(totalSupply, "1")) throw new Error("FA2 total_supply readback did not prove the 1-of-1 supply.");
  const defaultPresentation = await adapter.view(bindings.collection, "default_presentation", { prim: "Unit" });
  if (!defaultPresentation || !containsBytes(defaultPresentation, plan.artifact.rootIntegrity.digest) || !containsBytes(defaultPresentation, expectedManifestUri)) throw new Error("FA2 default_presentation readback did not bind the canonical digest and receipt-bound harness URI.");
  const holdStorage = await adapter.storage(bindings.hold);
  if (!containsString(holdStorage, creator)) throw new Error("Hold storage readback did not retain the signer administrator.");

  journalState.status = "published-and-read-back";
  journalState.bindings = { ...bindings };
  journalState.readback = {
    exactCanonicalShell: true,
    harnessId: bindings.harnessId,
    activeRevision: true,
    collectionEditionSize: 1,
    tokenId: 1,
    tokenOwner: creator,
    canonicalRootDigest: plan.artifact.rootIntegrity.digest,
    localPreview: plan.artifact.localPreview,
  };
  await journal(output, journalState);
  process.stdout.write(`${JSON.stringify({ status: journalState.status, network, creator, bindings, receiptCount: journalState.operations.length, output }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
