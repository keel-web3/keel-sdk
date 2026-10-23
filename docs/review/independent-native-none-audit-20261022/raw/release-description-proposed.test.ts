/** Real disposable PostgreSQL / real normal service imports / free public reads.
 * No injected source, context, compiler, forecast, registry or transaction port. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { startDisposablePostgres } from "./disposable-postgres";
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const json = (v: unknown) => JSON.stringify(v, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
const docs = path.resolve("../../docs/reviews/studio-publication-20261022/temporal-normal-postgres");
const evidence = process.env.KEEL_TEMPORAL_NORMAL_EVIDENCE!, rpc = "https://rpc.sepolia.ethpandaops.io", chainId = 11155111;
async function save(name: string, value: unknown) { assert.ok(evidence?.startsWith("/private/tmp/")); await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, name), json(value), { mode: 0o600 }); }
async function publicReads() {
  const { readOnlyRpcGuard, configuredRpcRecipientHashes } = await import(pathToFileURL(path.join(docs, "read-only-rpc-guard.mjs")).href);
  const { observeGuardedRpcFetch } = await import(pathToFileURL(path.join(docs, "rpc-observer.mjs")).href);
  const { createTerminalLatch } = await import(pathToFileURL(path.join(docs, "exact-case-sequence.mjs")).href);
  const real = globalThis.fetch.bind(globalThis), observations: unknown[] = [], latch = createTerminalLatch();
  const guarded = readOnlyRpcGuard(async (resource: string, init: RequestInit) => {
    latch.assertClear(); const calls = JSON.parse(init.body as string); for (const x of Array.isArray(calls) ? calls : [calls]) {
      assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode", "eth_call", "eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(x.method));
      if (x.method === "eth_call") { assert.ok(x.params.length <= 2); assert.ok((x.params[0]?.data?.length ?? 0) <= 8194, "No creator program or simulation may be disclosed"); }
    } return real(resource, init);
  }, configuredRpcRecipientHashes([rpc]), observations, { snapshot: () => ({ denials: 0 }) });
  const observer = observeGuardedRpcFetch(guarded, { onSecurityObservation: (row: unknown) => latch.observeResponse(row) }); globalThis.fetch = observer.fetch;
  return { async finish() { const result = await observer.finish(); return { ...result, latch: latch.snapshot() }; }, assertClear: () => latch.assertClear() };
}
async function childReload() {
  const reads = await publicReads(), spec = JSON.parse(await readFile(process.env.KEEL_TEMPORAL_NORMAL_RELOAD!, "utf8"));
  const { sql } = await import("../../src/server/db"), api = await import("../../src/server/services/release-service"), { readOwnedInlineCandidateSource } = await import("../../src/server/services/saved-source-preparation-service");
  try {
    const [a] = await sql`select active_revision,manifest_digest from artifacts where id=${spec.project}`; const [r] = await sql`select revision from launch_releases where id=${spec.release}`;
    const owned = await readOwnedInlineCandidateSource(spec.owner, { artifactId: spec.project, activeRevision: a!.active_revision, manifestDigest: a!.manifest_digest, release: { id: spec.release, revision: r!.revision } });
    await assert.rejects(api.continueReleasePublish(spec.other, spec.release, r!.revision));
    const staleRetry = await api.continueReleasePublish(spec.owner, spec.release, spec.previousRevision), currentRetry = await api.continueReleasePublish(spec.owner, spec.release, r!.revision);
    console.log(json({ sourceFingerprint: owned.sourceFingerprint, resources: owned.input.files.map(f => ({ id: f.id, bytes: f.bytes.length, sha256: sha(f.bytes) })), staleRetry, currentRetry, reads: await reads.finish() })); reads.assertClear();
  } finally { await sql.end({ timeout: 2 }); }
}
if (process.env.KEEL_TEMPORAL_NORMAL_RELOAD) await childReload();
else test("actual normal temporal intake, read-only capture, durable adoption and response-loss recovery", { timeout: 480_000 }, async t => {
  const input = JSON.parse(await readFile(path.join(docs, "qualified-inputs.json"), "utf8")); const source = Buffer.from(input.source.base64, "base64"), preview = Buffer.from(input.preview.base64, "base64");
  assert.equal(source.length, 1786); assert.equal(sha(source), "a421a05635b124a135c770d3c9cc814c515cfcdaa4a7b3e68f24a332033e5561"); assert.equal(sha(preview), input.preview.sha256);
  const pg = await startDisposablePostgres(); t.after(() => pg.stop()); const root = await mkdtemp(path.join(tmpdir(), "keel-temporal-normal-pg-")); t.after(() => rm(root, { recursive: true, force: true }));
  const catalogs = "/private/tmp/keel-current-original-native-actual-3fae110d/stopped-evidence/catalogs";
  for (const [name, expected] of [["inline.json", "2d54c8a4ab1e3360fdf702af0113c27739dcddf44abd4e0682f68606005652d7"], ["modules.json", "dae37deca2b6395603f1139afa1650e8730b8b9c592eed0fac5624b1fcfe30e4"]]) { const b = await readFile(path.join(catalogs, name!)); assert.equal(sha(b), expected); await writeFile(path.join(root, name!), b); }
  const catalog = JSON.parse(await readFile(path.join(root, "inline.json"), "utf8"));
  Object.assign(process.env, { DATABASE_URL: pg.url, NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "https://temporal.local.test", NEXT_PUBLIC_CHAIN_ID: String(chainId), NEXT_PUBLIC_WALLET_RPC_URL: rpc,
    BLOB_STORAGE_PATH: path.join(root, "blobs"), PLAN_STORAGE_PATH: path.join(root, "plans"), KEEL_CHAIN_ID: String(chainId), KEEL_RPC_URL: rpc, KEEL_MODULE_CATALOG_PATH: path.join(root, "modules.json"), KEEL_INLINE_FRAGMENT_CATALOG_PATH: path.join(root, "inline.json"), KEEL_PUBLICATION_WORKER_PAUSED: "1" });
  for (const key of Object.keys(process.env)) if (/PRIVATE_KEY|TOKEN|SECRET|PASSWORD|ALCHEMY/u.test(key)) delete process.env[key];
  const reads = await publicReads(); const migration = postgres(pg.url, { max: 1, prepare: false }); await migrate(drizzle(migration), { migrationsFolder: path.resolve("drizzle") }); await migration.end({ timeout: 2 });
  const { db, sql } = await import("../../src/server/db"); t.after(() => sql.end({ timeout: 2 })); const schema = await import("../../src/server/db/schema");
  const owner = randomUUID(), other = randomUUID(); await db.insert(schema.studioUsers).values([{ id: owner, displayName: "Synthetic temporal owner", walletAddress: "0x1111111111111111111111111111111111111111" }, { id: other, displayName: "Other owner", walletAddress: "0x2222222222222222222222222222222222222222" }]);
  await db.insert(schema.chains).values({ chainId, name: "Sepolia real public read-only", rpcUrl: rpc, browserRpcUrl: rpc });
  await db.insert(schema.chainContracts).values([{ chainId, kind: "keel-harness-builder", address: catalog.builder, label: "Exact configured public registry" }, { chainId, kind: "chunk-store", address: catalog.store, label: "Exact configured public Hold" }]);
  const { artifactFormData } = await import("../../src/lib/artifact-form-data"), { inferFilePurpose } = await import("../../src/lib/file-purpose"), { createStudioProjectJson } = await import("../../src/server/services/studio-project-json");
  const api = await import("../../src/server/services/release-service"), planning = await import("../../src/server/services/release-planning-service"), { defaultReleaseDraft } = await import("../../src/lib/release-schema");
  const { readOwnedInlineCandidateSource } = await import("../../src/server/services/saved-source-preparation-service"), { readBlob } = await import("../../src/server/storage/content-store");
  const rows = async (project: string, release: string) => { const [a] = await sql`select to_jsonb(a) row from artifacts a where id=${project}`, [r] = await sql`select to_jsonb(r) row from launch_releases r where id=${release}`;
    const jobs = await sql`select to_jsonb(j) row from upload_jobs j where artifact_id=${project}`, plans = await sql`select to_jsonb(p) row from resource_upload_plans p where artifact_id=${project} order by resource_id`, ops = await sql`select to_jsonb(o) row from release_operations o where release_id=${release}`;
    return { artifact: a!.row, release: r!.row, jobs: jobs.map(v => v.row), plans: plans.map(v => v.row), operations: ops.map(v => v.row) }; };
  const stages: unknown[] = []; let phase = "normal-intake", pass = false;
  const make = async (mode: "auto" | "native" | "raw") => {
    const files = [input.source, input.preview].map((v, i) => { const file = new File([i ? preview : source], v.fileName, { type: v.mediaType, lastModified: 12 }), p = inferFilePurpose(file.name, file.type); return { key: file.name, path: file.name, file, componentLabel: p.label, componentRole: p.role, componentFormat: p.format, updateMode: "manual" as const, reusableAsset: false }; });
    const form = artifactFormData({ name: `Temporal ${mode}`, description: "Owned synthetic real-PG continuation", remoteUri: "", storageStrategy: "onchain", publishToIpfs: false, marketplaceExportMode: "recursive", generatePreview: false, webpQuality: 82, thumbnailCaptureMode: "off", thumbnailDelayMs: 0, thumbnailDurationMs: 0, thumbnailFrameRate: 30, librarySelections: [], assetPresentation: "automatic", files, entrypointResourceId: input.source.fileName, collectorImageResourceId: input.preview.fileName, payloadStorage: mode === "raw" ? "raw" : "compact", idempotencyKey: randomUUID(), ...(mode === "native" ? { mediaOptimizationIntents: [{ resourceId: input.source.fileName, mode: "native" as const, mediaType: "video/mp4", integrity: { algorithm: "sha256" as const, digest: "0x" + sha(source), byteLength: source.length } }] } : {}) });
    const fields: Record<string, string> = {}; for (const [k, v] of form) if (k !== "files") { assert.equal(typeof v, "string"); fields[k] = v as string; }
    const body = { fields, files: await Promise.all((form.getAll("files") as File[]).map(async f => ({ fileName: f.name, mediaType: f.type, bytesBase64: Buffer.from(await f.arrayBuffer()).toString("base64") }))) };
    const made = await createStudioProjectJson(owner, body, AbortSignal.timeout(90_000)), again = await createStudioProjectJson(owner, body); assert.equal(again.id, made.id); assert.equal(again.jobId, made.jobId);
    const d = defaultReleaseDraft(), release = await api.createReleaseDraft(owner, { ...d, artifactId: made.id, chainId, title: `Temporal ${mode}`, description: "Owned synthetic real-PG continuation", releaseType: "one-of-one", supply: "1", page: { ...d.page, studio: { ...d.page.studio, presentationMode: "inline" } } });
    let p = await planning.readReleasePlanning(owner, release.id); assert.equal(p.resolved.status, "ready-for-review", json(p.resolved.issues)); if (!p.resolved.reviewed) p = await planning.changeReleasePlanning(owner, release.id, { operation: "review", commandId: randomUUID(), expectedRevision: p.revision, configurationKey: p.resolved.configurationKey }); return { project: made.id, release: release.id, revision: p.revision };
  };
  try {
    const f = await make("auto"), before = await rows(f.project, f.release); stages.push({ phase, f, before }); assert.equal(before.jobs.length, 1); assert.equal(before.operations.length, 0);
    phase = "actual-normal-context"; const ctx = await api.captureNormalTemporalMediaContext(owner, f.release, f.revision, { generation: randomUUID(), signal: AbortSignal.timeout(90_000) }); assert.ok(ctx); await ctx.assertCurrent(); assert.deepEqual(await rows(f.project, f.release), before); stages.push({ phase, tokenURIBytes: Buffer.byteLength(ctx.expectedTokenURI), tokenURISHA256: sha(ctx.expectedTokenURI) });
    phase = "normal-auto-adoption"; const lost = await api.continueReleasePublish(owner, f.release, f.revision, undefined, { signal: AbortSignal.timeout(90_000) }); const adopted = await rows(f.project, f.release); stages.push({ phase, lost, adopted });
    assert.ok(adopted.jobs[0].options.currentMediaSource, "Measured actual AUTO media adoption required; otherwise report the real module/prerequisite gate"); assert.equal(adopted.jobs[0].options.mediaSourceTransitions.length, 1); assert.equal(adopted.release.revision, f.revision + 1); assert.equal(adopted.artifact.active_revision, before.artifact.active_revision + 1); assert.equal(adopted.jobs[0].request_digest, before.jobs[0].request_digest); assert.deepEqual(adopted.jobs[0].options.retainedSourceIntake, before.jobs[0].options.retainedSourceIntake); assert.deepEqual(Buffer.from(await readBlob(sha(source))), source); assert.equal(adopted.operations.length, 0);
    phase = "response-loss-fresh-process"; const pin = { artifactId: f.project, activeRevision: adopted.artifact.active_revision, manifestDigest: adopted.artifact.manifest_digest, release: { id: f.release, revision: adopted.release.revision } }; const selected = await readOwnedInlineCandidateSource(owner, pin); stages.push({ phase, sourceFingerprint: selected.sourceFingerprint });
    const spec = path.join(root, "reload.json"); await writeFile(spec, json({ ...f, owner, other, previousRevision: f.revision })); const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(?:PATH|NODE_ENV|DATABASE_URL|BLOB_STORAGE_PATH|PLAN_STORAGE_PATH|KEEL_INLINE_FRAGMENT_CATALOG_PATH|KEEL_MODULE_CATALOG_PATH|KEEL_CHAIN_ID|KEEL_RPC_URL|NEXT_PUBLIC_CHAIN_ID|NEXT_PUBLIC_WALLET_RPC_URL)$/u.test(k))); env.KEEL_TEMPORAL_NORMAL_RELOAD = spec;
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", import.meta.filename], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] }), out: Buffer[] = [], err: Buffer[] = []; child.stdout.on("data", v => out.push(v)); child.stderr.on("data", v => err.push(v)); const exit = await new Promise<number | null>((resolve, reject) => { const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Error("Owned fresh-process reload exceeded its120s deadline")); },120_000); child.once("exit", code => { clearTimeout(timer); resolve(code); }); child.once("error", error => { clearTimeout(timer); reject(error); }); }); await save("fresh-process.json", { exit, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }); assert.equal(exit, 0); assert.equal((await rows(f.project, f.release)).jobs[0].options.mediaSourceTransitions.length, 1);
    phase = "owner-concurrent-CAS"; const race = await make("auto"); await assert.rejects(api.continueReleasePublish(other, race.release, race.revision)); const result = await Promise.allSettled([api.continueReleasePublish(owner, race.release, race.revision), api.continueReleasePublish(owner, race.release, race.revision)]); const current = await rows(race.project, race.release); assert.equal(current.jobs[0].options.mediaSourceTransitions.length, 1); assert.equal(current.release.revision, race.revision + 1); assert.equal(current.operations.length, 0); stages.push({ phase, result: result.map(v => v.status), current });
    for (const mode of ["native", "raw"] as const) { phase = `${mode}-preserved`; const p = await make(mode), start = await rows(p.project, p.release); await api.continueReleasePublish(owner, p.release, p.revision); const after = await rows(p.project, p.release); assert.equal(after.jobs[0].options.currentMediaSource, undefined); assert.deepEqual(after.jobs[0].options.mediaSourceTransitions ?? [], []); assert.equal(after.jobs[0].request_digest, start.jobs[0].request_digest); assert.deepEqual(Buffer.from(await readBlob(sha(source))), source); assert.equal(after.operations.length, 0); stages.push({ phase, p }); } pass = true;
  } catch (error) { stages.push({ phase, status: "FAIL_OR_EXTERNAL_GATE", error: { name: (error as Error).name, message: (error as Error).message, stack: (error as Error).stack } }); throw error; }
  finally { const totals = await sql`select (select count(*)::integer from upload_jobs) jobs,(select count(*)::integer from artifacts) artifacts,(select count(*)::integer from resource_upload_plans) plans,(select count(*)::integer from release_operations) wallet_operations`;
    const failedJobs = await sql`select id,status,error,request_digest,artifact_id,options from upload_jobs order by created_at`;
    await save("actual-normal-postgres.json", { finalCounts: totals[0], failedJobs, site: "814a6f983c66cce23fa17660a9e376950850afa9", sdk: "edaa7446c2cfcec6eee27ca13d3f0cc4718822f7", environment: { node: process.version, postgres: "Real disposable17 fully migrated", endpoint: rpc }, input: { bytes: source.length, sha256: sha(source), previewSHA256: sha(preview) }, result: pass ? "PASS" : "BLOCKED_OR_FAIL", phase, stages, publicReads: await reads.finish(), signing: "not-performed", remoteFullProgram: false, productionTouched: false }); }
});
