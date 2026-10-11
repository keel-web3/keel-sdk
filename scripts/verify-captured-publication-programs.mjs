import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, rm, cp, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { keccak256 } from 'viem';
import { createNativeGethRuntime } from './lib/native-geth-runtime.mjs';
import { GETH_IMAGE, validateManifest, validateCase, validateNativeBudget, normalizeAssemblyCapture, verifyWitness, witnessMissingReads, loadBoundFile, confinedPath, revive, stable, sha256, summarizeSimulation } from './lib/captured-publication-fixture.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const methods = new Set(['web3_clientVersion', 'eth_chainId', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getCode', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getStorageAt', 'eth_call', 'eth_estimateGas', 'eth_simulateV1', 'debug_traceCall', 'admin_nodeInfo']);
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? { $keelDiagnosticBigInt: item.toString() } : item, 2) + '\n';

async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function walk(root, sub = '') {
  const files = [];
  for (const name of (await readdir(join(root, sub))).sort()) {
    const path = join(sub, name), info = await lstat(join(root, path));
    assert.ok(!info.isSymbolicLink(), 'Datadir links are forbidden');
    if (info.isDirectory()) files.push(...await walk(root, path));
    else { assert.ok(info.isFile(), 'Datadir must contain regular files only'); files.push(path); }
  }
  return files;
}
async function verifyDatadir(root, descriptor) {
  const directory = await confinedPath(root, descriptor.path);
  assert.ok(Array.isArray(descriptor.files) && descriptor.files.length > 0, 'Datadir inventory required');
  assert.ok(descriptor.files.every(file => /^geth\/chaindata\/[a-zA-Z0-9_./-]+$/.test(file.path) && !file.path.split('/').includes('..')), 'Only reviewed chaindata files may be copied; no keys/config');
  assert.deepEqual((await walk(directory)).sort(), descriptor.files.map(file => file.path).sort(), 'Datadir inventory incomplete');
  for (const file of descriptor.files) {
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && /^[0-9a-f]{64}$/.test(file.sha256));
    const path = await confinedPath(directory, file.path);
    assert.equal((await lstat(path)).size, file.bytes, 'Datadir file size changed');
    assert.equal(await fileDigest(path), file.sha256, 'Datadir file digest changed');
  }
  return directory;
}
function checkHeader(actual, expected, canonical) {
  assert.ok(actual, 'Pinned block missing from native state');
  for (const key of ['timestamp', 'gasLimit', 'baseFeePerGas']) assert.equal(BigInt(actual[key]), BigInt(expected[key]), `Pinned header ${key} differs`);
  if (canonical) for (const key of ['number', 'hash', 'stateRoot']) assert.equal(actual[key].toLowerCase(), expected[key].toLowerCase(), `Canonical ${key} differs`);
}

export async function runCapturedProgramGate(manifestPath, evidencePath, { validateOnly = false, runtimeDirectory } = {}) {
  assert.ok(manifestPath && evidencePath, 'Use --manifest <private manifest.json> --evidence <private result.json>');
  const root = dirname(resolve(manifestPath));
  const manifestBytes = await readFile(manifestPath);
  const manifest = validateManifest(JSON.parse(manifestBytes));
  const prepared = [];
  // Validate every case before starting Docker. Missing data is never a skip.
  for (const item of manifest.cases) {
    const captureBytes = await loadBoundFile(root, item.capture);
    const plainCapture = JSON.parse(captureBytes.toString('utf8'));
    const capture = plainCapture.schema === 'keel-private-full-plan-diagnostic@1' ? normalizeAssemblyCapture(plainCapture) : JSON.parse(captureBytes.toString('utf8'), revive);
    const uriBytes = await loadBoundFile(root, item.expectedURI);
    const expectedURI = uriBytes.toString('utf8');
    assert.ok(Buffer.from(expectedURI, 'utf8').equals(uriBytes), 'Expected URI file is not exact UTF-8');
    const checked = validateCase(item.id, capture, expectedURI);
    const budget = validateNativeBudget(checked.input, checked.header, item.rpcGasCap);
    const witness = JSON.parse((await loadBoundFile(root, item.snapshot.witness)).toString('utf8'));
    const proved = verifyWitness(checked.header, witness);
    const allCalls = [...checked.calls, checked.input.metadataCall, ...(checked.input.observationCalls ?? []), ...(checked.input.requiredReaderCalls ?? []).map(item => item.call)];
    const requiredAccounts = new Set([...allCalls.flatMap(call => [call.from, call.to]), checked.input.reader].map(x => x.toLowerCase()));
    for (const address of requiredAccounts) assert.ok(proved.inventory.has(address), `${item.id}: missing direct account proof`);
    assert.equal(keccak256(proved.inventory.get(checked.input.reader.toLowerCase()).account.code), checked.input.readerRuntimeCodeHash.toLowerCase(), 'Captured reader runtime differs from proved code');
    prepared.push({ item, capture, ...checked, budget, witness, ...proved });
  }
  const evidence = { schema: 'keel-native-original-program-result@1', manifestSHA256: sha256(manifestBytes), gethImage: GETH_IMAGE,
    network: 'none', signing: 'not-performed', transactionsSubmitted: 0, providerAcceptance: false,
    validationOnly: validateOnly, gateAccepted: false, cases: [], sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() };
  const save = async () => { await mkdir(dirname(resolve(evidencePath)), { recursive: true, mode: 0o700 }); await writeFile(evidencePath, json(evidence), { mode: 0o600 }); };
  if (validateOnly) { evidence.scope = 'manifest-and-proof-binding-only-no-native-execution'; await save(); return evidence; }
  if (runtimeDirectory) assert.ok(manifest.cases.every(item => item.snapshot.mode === 'proof-reconstruction'), 'Static IPC adapter supports diagnostic reconstruction only; canonical datadir fork configuration requires Docker RPC inspection');
  else docker('image', 'inspect', GETH_IMAGE); // No pull or network fallback.
  const { simulateKeelPublicationBeforeFunding } = await import('../packages/sdk/dist/publication-preflight.js');
  for (const preparedCase of prepared) {
    const { item, capture, calls, input, header, alloc, inventory } = preparedCase;
    const temporary = await mkdtemp(join(tmpdir(), 'keel-original-native-'));
    const container = `keel-original-${item.id}-${process.pid}`;
    const canonical = item.snapshot.mode === 'canonical-datadir';
    const entry = { id: item.id, stateMode: item.snapshot.mode, canonicalProvenance: header, capturedProgramSHA256: sha256(stable(capture.wireRequest ?? capture.exactSimulationInput)),
      capturedOriginalWireAvailable: capture.wireRequest !== null, captureKind: capture.captureKind ?? 'captured-original-wire',
      rpcGasCap: item.rpcGasCap, localProgramBudget: preparedCase.budget, originalPreparationCalls: calls.length,
      completeUnallocatedCallCount: calls.length + (input.requiredReaderCalls?.length ?? 0) + (input.observationCalls?.length ?? 0) + 1,
      gateAccepted: false, observations: [] };
    evidence.cases.push(entry);
    const native = runtimeDirectory ? createNativeGethRuntime({ runtimeDirectory: resolve(runtimeDirectory), dataDirectory: join(temporary, 'data'), ipcPath: join(temporary, 'geth.ipc'), logPath: join(temporary, 'geth.log') }) : null;
    if (native) entry.nativeRuntime = native.evidence;
    let started = false;
    let requestSequence = 0;
    const rawRpc = async (method, params) => {
      assert.ok(methods.has(method), 'Forbidden native RPC method');
      if (native) return native.rawRequest(method, params);
      const request = { jsonrpc: '2.0', id: 1, method, params };
      const file = `request-${++requestSequence}.json`;
      await writeFile(join(temporary, file), json(request), { mode: 0o600 });
      try { return JSON.parse(docker('exec', container, 'wget', '-Y', 'off', '-q', '-O', '-', '--header=Content-Type: application/json', `--post-file=/fixture/${file}`, 'http://127.0.0.1:8545')); }
      finally { await rm(join(temporary, file), { force: true }); }
    };
    const rpc = async (method, params) => {
      const response = await rawRpc(method, params);
      if (method === 'eth_simulateV1') {
        const observation = { phase: 'sdk-generated-replay', request: { method, params }, response };
        entry.observations.push(observation);
        observation.summary = summarizeSimulation({ method, params }, response);
      }
      if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code, data: response.error.data });
      return response.result;
    };
    try {
      if (canonical) {
        const source = await verifyDatadir(root, item.snapshot.datadir);
        await cp(source, join(temporary, 'data'), { recursive: true, errorOnExist: true, force: false });
        await verifyDatadir(temporary, { ...item.snapshot.datadir, path: 'data' });
      } else {
        const genesis = JSON.parse(await readFile(new URL('../tests/fixtures/native-geth-publication/genesis.json', import.meta.url), 'utf8'));
        for (const systemAddress of Object.keys(genesis.alloc).filter(address => address !== '11'.repeat(20)))
          assert.ok(inventory.has(`0x${systemAddress}`), 'Protocol system account proof missing; cannot substitute zero state');
        // No fake funding/executor or unproved contract allocation. Canonical proofs
        // must include protocol system accounts used in the reconstruction too.
        genesis.alloc = alloc;
        genesis.timestamp = header.timestamp; genesis.gasLimit = header.gasLimit;
        genesis.baseFeePerGas = header.baseFeePerGas;
        genesis.coinbase = header.miner ?? header.coinbase;
        genesis.mixHash = header.mixHash;
        assert.match(genesis.coinbase ?? '', /^0x[0-9a-f]{40}$/i);
        assert.match(genesis.mixHash ?? '', /^0x[0-9a-f]{64}$/i);
        await writeFile(join(temporary, 'genesis.json'), JSON.stringify(genesis), { mode: 0o600 });
        entry.reconstructionGenesisSHA256 = sha256(JSON.stringify(genesis));
        if (native) native.init(join(temporary, 'genesis.json'));
        else docker('run', '--pull=never', '--rm', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${temporary}:/fixture`, GETH_IMAGE, '--datadir', '/fixture/data', 'init', '/fixture/genesis.json');
      }
      if (native) await native.start(item.rpcGasCap);
      else docker('run', '--pull=never', '-d', '--name', container, '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`,
        '--memory', '1536m', '--cpus', '2', '-v', `${temporary}:/fixture`, GETH_IMAGE, '--datadir', '/fixture/data', '--networkid', '31337', '--syncmode', 'full', '--nodiscover', '--maxpeers', '0', '--cache', '128', '--ipcdisable',
        '--http', '--http.addr', '127.0.0.1', '--http.vhosts', 'localhost', '--http.api', 'eth,net,web3,debug,admin', '--rpc.gascap', String(item.rpcGasCap), '--rpc.evmtimeout', '45s', '--rpc.http-body-limit', '32');
      started = true;
      for (let attempt = 0; ; attempt++) { try { await rpc('eth_chainId', []); break; } catch (error) { if (attempt >= 40) throw error; await delay(100); } }
      if (!native) assert.equal(JSON.parse(docker('inspect', container))[0].HostConfig.NetworkMode, 'none');
      assert.equal(await rpc('eth_chainId', []), '0xaa36a7');
      entry.clientVersion = await rpc('web3_clientVersion', []);
      assert.match(entry.clientVersion, /Geth\/v1\.17\.8/);
      const reviewedConfig = JSON.parse(await readFile(new URL('../tests/fixtures/native-geth-publication/genesis.json', import.meta.url), 'utf8')).config;
      // The reviewed static IPC helper deliberately exposes no admin methods.
      // Its only supported state mode here is our exact bound diagnostic genesis.
      const config = native ? JSON.parse(await readFile(join(temporary, 'genesis.json'), 'utf8')).config : (await rpc('admin_nodeInfo', [])).protocols?.eth?.config;
      assert.ok(config, 'Native fork configuration unavailable');
      entry.forkConfigurationEvidence = native ? 'exact-bound-reconstruction-genesis-not-canonical-chain-datadir' : 'running-geth-admin-nodeInfo';
      for (const key of ['chainId', 'homesteadBlock', 'eip150Block', 'eip155Block', 'eip158Block', 'byzantiumBlock', 'constantinopleBlock', 'petersburgBlock', 'istanbulBlock', 'berlinBlock', 'londonBlock', 'shanghaiTime', 'cancunTime', 'pragueTime', 'osakaTime', 'bpo1Time', 'bpo2Time', 'amsterdamTime', 'blobSchedule'])
        assert.equal(stable(config[key]), stable(reviewedConfig[key]), `Native fork profile differs: ${key}`);
      entry.nativeForkConfig = config;
      const tag = canonical ? header.number : '0x0';
      const base = await rpc('eth_getBlockByNumber', [tag, false]);
      checkHeader(base, header, canonical);
      entry.localHeader = base;
      entry.headerMapping = canonical ? 'unchanged-canonical-number-and-hash' : { canonicalNumber: header.number, localNumber: tag, canonicalHash: header.hash, localHash: base.hash, limitation: 'NUMBER/BLOCKHASH/history equivalence unproven; diagnostic only' };
      for (const { account } of inventory.values()) {
        assert.equal((await rpc('eth_getCode', [account.address, tag])).toLowerCase(), account.code.toLowerCase());
        assert.equal(BigInt(await rpc('eth_getBalance', [account.address, tag])), BigInt(account.balance));
        assert.equal(BigInt(await rpc('eth_getTransactionCount', [account.address, tag])), BigInt(account.nonce));
        for (const slot of account.storageProof) assert.equal(BigInt(await rpc('eth_getStorageAt', [account.address, slot.key, tag])), BigInt(slot.value));
      }
      if (capture.wireRequest) {
        const original = structuredClone(capture.wireRequest);
        if (!canonical) original.params[1] = tag;
        assert.equal(stable(original.params[0]), stable(capture.wireRequest.params[0]), 'Reconstruction changed original calls/gas');
        const baseline = await rawRpc(original.method, original.params);
        const baselineObservation = { phase: 'captured-original-wire', request: original, response: baseline };
        entry.observations.push(baselineObservation);
        baselineObservation.summary = summarizeSimulation(original, baseline);
      } else entry.historicalFailureReproduction = 'not-established-source-assembly-capture-contains-no-original-wire-response';
      // debug_traceCall has no access to eth_simulateV1's later ephemeral state.
      // Trace the first exact transaction (the entire six-call atomic paid batch),
      // and explicitly refuse to call that full sequential witness coverage.
      const prestate = await rawRpc('debug_traceCall', [calls[0], tag, { tracer: 'prestateTracer', timeout: '30s', tracerConfig: { diffMode: false } }]);
      const frame = await rawRpc('debug_traceCall', [calls[0], tag, { tracer: 'callTracer', timeout: '30s', tracerConfig: { onlyTopCall: false, withLog: false } }]);
      entry.innerTrace = { coverage: calls.length === 1 ? 'complete-atomic-transaction-at-base-state' : 'first-transaction-only-not-later-ephemeral-state', prestate, callTrace: frame };
      if (!prestate.error) {
        entry.missingWitnessReads = witnessMissingReads(prestate.result, inventory);
        if (entry.missingWitnessReads.length) throw new Error('Native prestate tracer accessed unproved account/storage; zero defaults rejected');
      } else if (!canonical) throw new Error('Native prestate tracer unavailable; reconstructed witness coverage unproved');
      const replayInput = structuredClone(input);
      if (!canonical) replayInput.blockNumber = 0n;
      const before = stable(replayInput);
      entry.sdkProof = await simulateKeelPublicationBeforeFunding(replayInput, { request: ({ method, params }) => rpc(method, params) });
      assert.equal(stable(replayInput), before, 'SDK mutated original input');
      assert.equal(entry.sdkProof.completeTokenUriBytes, Buffer.byteLength(input.expectedTokenURI));
      assert.equal(entry.sdkProof.validatedTransactionCalls, calls.length);
      checkHeader(await rpc('eth_getBlockByNumber', [tag, false]), header, canonical);
      entry.localExecutionPassed = true;
      // Proof reconstruction remains diagnostic until full sequential + appended
      // read access coverage and all header-dependent semantics can be verified.
      if (!canonical) throw new Error('Reconstruction ran but full witness/header equivalence is not established; no acceptance');
      entry.gateAccepted = true;
    } catch (error) {
      entry.failure = { name: error.name, message: error.message, kind: error.kind, diagnostic: error.diagnostic };
    } finally {
      let removed = !started;
      try { if (native) { await native.stop(); removed = true; } else if (started) { docker('rm', '-f', container); removed = true; } }
      catch (error) { entry.gateAccepted = false; entry.cleanupFailure = { message: error.message, retainedTemporaryDirectory: temporary, container }; }
      if (removed) await rm(temporary, { recursive: true, force: true });
      await save();
    }
  }
  evidence.gateAccepted = evidence.cases.length === 3 && evidence.cases.every(item => item.gateAccepted);
  evidence.scope = 'local-native-original-program-regression-not-live-provider-or-publication-acceptance';
  await save();
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), allowed = new Set(['--manifest', '--evidence', '--validate-only', '--runtime-directory']);
    const options = {};
    for (let index = 0; index < args.length; index++) {
      assert.ok(allowed.has(args[index]), 'Unknown argument');
      if (args[index] === '--validate-only') options.validateOnly = true;
      else { assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), 'Missing argument'); const key = args[index] === '--runtime-directory' ? 'runtimeDirectory' : args[index].slice(2); options[key] = args[++index]; }
    }
    const result = await runCapturedProgramGate(options.manifest, options.evidence, options);
    console.log(JSON.stringify({ scope: result.scope, gateAccepted: result.gateAccepted, validationOnly: result.validationOnly, cases: result.cases.map(item => ({ id: item.id, gateAccepted: item.gateAccepted })) }));
    process.exitCode = result.gateAccepted || options.validateOnly ? 0 : 1;
  } catch (error) { console.error(`Original-program gate refused: ${error.message}`); process.exitCode = 1; }
}
