/* eslint-disable @typescript-eslint/no-explicit-any -- Named read-only DB/source
 * adapters exercise the actual service against deliberate persisted-state faults.
 * This unit fixture is not native/runtime/chain integration evidence. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as protocol from "@keel/protocol";
import * as core from "@keel/studio-core";
import { createRecursiveUploadPlan } from "@keel/builder";
import * as canonical from "../../src/lib/canonical-inline-artifact";
import { createInlineTokenURIStudioUploadPlan } from "../../src/server/services/inline-upload-plan";
import * as uploadIdentity from "../../src/server/services/upload-plan-object-identity";
import { currentCanonicalCatalogFixture } from "../helpers/current-canonical-catalog-fixture";
import { poster } from "../helpers/collector-native-media-fixture";
import * as sourceInventory from "../../src/server/services/creator-prepared-source";
import * as replan from "../../src/lib/unfunded-preview-replan";
import * as deadline from "../../src/lib/unfunded-publication-deadline";
import * as mediaTransition from "../../src/server/services/media-source-transition";
import { deadlineFixture, generation } from "./support/unfunded-deadline-fixture";
const require = createRequire(import.meta.url);
const app = path.resolve(import.meta.dirname, "../..");
const hash = (value: Uint8Array) => `0x${createHash("sha256").update(value).digest("hex")}`;
async function canonicalFixture() {
  const registered = currentCanonicalCatalogFixture(true);
  const originals = [{ id: "original", fileName: "original.html", mediaType: "text/html", bytes: Buffer.from("<!doctype html><p>exact original</p>") },
    { id: "poster", fileName: "home-preview.png", mediaType: "image/png", bytes: Buffer.from(poster) }];
  const defaults = { revision: 1, payloadStorage: "compact", compression: "auto" };
  const saved = sourceInventory.currentStudioSourceRetention({ files: originals, entrypointResourceId: "original", collectorImageResourceId: "poster",
    jobId: "00000000-0000-4000-8000-000000000001", requestDigest: `0x${"ab".repeat(32)}`, buildDefaults: defaults });
  const inline = await registered.api.buildConfiguredInlineCreatorRoot({ ...registered.input, files: originals,
    entrypointResourceId: "original", collectorImageResourceId: "poster", compression: "none" }); assert.ok(inline);
  const assets = canonical.canonicalInlineArtifactAssets({ ...inline, viewer: "keel-verification-shell" });
  const prepared = await core.prepareStudioArtifact({ id: "artifact", name: "Current canonical graph", creator: deadlineFixture().ownerWallet!,
    createdAt: "2026-10-22T00:00:00.000Z", revision: 2, parentRevision: 1, payloadStorage: "compact", contractReadableFallback: true,
    assets: [{ id: "poster", fileName: "home-preview.png", mediaType: "image/png", bytes: originals[1]!.bytes, role: "preview" }, ...assets.assets],
    extensions: { "keel:retained-source": saved.declaration, "keel:retained-source-intake": saved.intake } });
  assert.equal(prepared.resources.length, 6, "Actual current graph: preview, prefix, asset, entrypoint, suffix and composite root.");
  const directory = await mkdtemp(path.join(tmpdir(), "keel-never-issued-graph-unit-"));
  const bytes = new Map<string, Uint8Array>();
  const put = (value: Uint8Array) => { bytes.set(hash(value).slice(2), Uint8Array.from(value)); return hash(value); };
  for (const item of originals) put(item.bytes);
  const resources = prepared.resources.map((item, index) => {
    const source = item.resource.sources.find(source => source.kind === "onchain");
    return { id: `resource-${index}`, artifactId: "artifact", resourceId: item.resource.id, originalName: item.fileName,
      mediaType: item.resource.mediaType, role: item.resource.role, sourceKind: source ? "onchain" : "local",
      chainId: source?.kind === "onchain" ? source.chainId : null, storeAddress: source?.kind === "onchain" ? source.store : null,
      objectId: source?.kind === "onchain" ? source.objectId : null, compression: item.compression,
      expectedDigest: item.decodedIntegrity.digest, storedDigest: item.storedIntegrity.digest,
      decodedBlobDigest: put(item.decodedBytes), storedBlobDigest: put(item.storedBytes),
      decodedByteLength: BigInt(item.decodedByteLength), storedByteLength: BigInt(item.storedByteLength) };
  });
  const root = prepared.resources.find(item => item.resource.id === canonical.KEEL_INLINE_TOKEN_URI_ROOT_ID)!;
  const preview = prepared.resources.find(item => item.resource.id === "poster")!;
  const manifestBytes = protocol.utf8ToBytes(protocol.canonicalJson(prepared.manifest)); put(manifestBytes);
  const plans = [];
  for (const [index, item] of [preview, root].entries()) {
    const outputDirectory = path.join(directory, `plan-${index}`);
    const plan = item === root ? await createInlineTokenURIStudioUploadPlan({ graph: inline.tokenURI.graph, existingParts: inline.tokenURI.existingParts,
      objectName: item.fileName, outputDirectory, chainId: registered.catalog.chainId, store: registered.catalog.store })
      : await createRecursiveUploadPlan(item.decodedBytes, { objectName: item.fileName, mediaType: item.resource.mediaType, compression: "none", outputDirectory });
    plans.push({ id: `plan-${index}`, artifactId: "artifact", artifactResourceId: resources.find(row => row.resourceId === item.resource.id)!.id,
      resourceId: item.resource.id, status: "ready", chainId: null, storeAddress: null, rootObjectId: null, planDirectory: outputDirectory, plan,
      publicationState: { ...replan.newUnissuedPublicationState(generation), planGeneration: generation } });
  }
  const plan = await createRecursiveUploadPlan(manifestBytes, { objectName: "manifest.json", mediaType: "application/json", compression: "none", outputDirectory: path.join(directory, "manifest") });
  plans.push({ id: "manifest-plan", artifactId: "artifact", artifactResourceId: null, resourceId: "manifest.json", status: "ready", chainId: null,
    storeAddress: null, rootObjectId: null, planDirectory: path.join(directory, "manifest"), plan,
    publicationState: { ...replan.newUnissuedPublicationState(generation), planGeneration: generation } } as any);
  const snapshot: any = structuredClone(deadlineFixture());
  const journal = snapshot.plans[0].publicationState.managedPublication;
  snapshot.artifact = { ...snapshot.artifact, chainId: registered.catalog.chainId, manifest: prepared.manifest, manifestDigest: prepared.manifestIntegrity.digest,
    manifestBlobDigest: hash(manifestBytes), manifestByteLength: BigInt(manifestBytes.length), fallbackImageResourceId: "poster" };
  snapshot.resources = resources; snapshot.plans = plans; snapshot.releases[0].artifactId = "artifact"; snapshot.releases[0].chainId = registered.catalog.chainId;
  snapshot.revisions[0].manifestDigest = prepared.manifestIntegrity.digest;
  snapshot.creatorJournals = []; snapshot.replicationSources = [];
  snapshot.sourceJobs = [{ id: saved.intake.jobId, artifactId: "artifact", creatorId: "creator", status: "ready", requestDigest: saved.intake.requestDigest,
    options: { retainedSource: saved.declaration, retainedSourceIntake: saved.intake, buildDefaults: defaults } }];
  Object.assign(journal, { storeAddress: registered.catalog.store, coordinatorPlanId: "manifest-plan", stagePlanIds: plans.map(row => row.id),
    preparationManifestDigest: prepared.manifestIntegrity.digest, preparationPlanSnapshotDigest: deadline.unfundedDeadlinePlanIdentity(plans) });
  return { snapshot, journal, bytes, catalog: registered.catalog, directory };
}
const base = await canonicalFixture();
after(() => rm(base.directory, { recursive: true, force: true }));
function fixture(withJournal = true) {
  const snapshot: any = structuredClone(base.snapshot), journal: any = structuredClone(base.journal);
  if (withJournal) snapshot.plans[2].publicationState.managedPublication = journal;
  const blobs = new Map([...base.bytes].map(([key, value]) => [key, Uint8Array.from(value)]));
  const selectedCatalog = structuredClone(base.catalog);
  const pin = { artifactId: "artifact", activeRevision: snapshot.artifact.activeRevision, manifestDigest: snapshot.artifact.manifestDigest,
    release: { id: snapshot.releases[0].id, revision: snapshot.releases[0].revision } };
  const tables = Object.fromEntries(["artifacts", "artifactResources", "artifactRevisions", "resourceUploadPlans", "creatorPreparedPublicationJournals", "blobs", "uploadJobs", "releaseStages", "releaseAccessLists", "releaseAccessMembers"].map(name => [name, new Proxy({ tableName: name }, { get: (target, key) => key === "tableName" ? target.tableName : { tableName: name, column: key } })]));
  const rows = (table: any, projection?: any) => {
    if (table === tables.artifacts) return [snapshot.artifact];
    if (table === tables.uploadJobs) return snapshot.sourceJobs;
    if (table === tables.resourceUploadPlans) return snapshot.plans;
    if (table === tables.artifactResources) return snapshot.resources;
    if (table === tables.creatorPreparedPublicationJournals) return snapshot.creatorJournals;
    if ([tables.releaseStages, tables.releaseAccessLists, tables.releaseAccessMembers].includes(table)) return [];
    throw new Error("Unexpected unit DB table");
  };
  const query = (projection?: any) => {
    let table: any, predicate = (_row: any) => true;
    const values = () => rows(table, projection).filter(predicate).map((row: any) => projection ? Object.fromEntries(Object.entries(projection).map(([key, field]: [string, any]) => [key, row[field.column]])) : row);
    const q: any = { from(value: any) { table = value; return q; }, where(value: any) { predicate = value; return q; }, orderBy() { return q; }, for() { throw new Error("Cost inspection must not take row locks"); },
      limit: async (count: number) => values().slice(0, count), then: (resolve: any, reject: any) => Promise.resolve(values()).then(resolve, reject) };
    return q;
  };
  const db: any = { select: query, execute: async () => [{ relation: snapshot.creatorJournals.length ? "creator_prepared_publication_journals" : null }], transaction: async (run: any, options: any) => {
    assert.deepEqual(options, { isolationLevel: "repeatable read", accessMode: "read only" }); return run(db);
  } };
  const denied = () => { throw new Error("Unexpected production mutation or non-scope adapter"); };
  const defaultsBoundary = new Error("exact-authoritative-defaults-boundary");
  const counters = { defaults: 0 };
  const bindings: Record<string, unknown> = {
    "@keel/protocol": protocol, "@keel/studio-core": core, "viem": require("viem"), "drizzle-orm": { and: (...checks: any[]) => (row: any) => checks.every(check => check(row)), eq: (field: any, value: any) => (row: any) => row[field.column] === value, inArray: (field: any, values: any[]) => (row: any) => values.includes(row[field.column]), sql: () => undefined },
    "~/env": { env: { MAX_UPLOAD_FILES: 8, MAX_UPLOAD_BYTES: 1_000_000, KEEL_CHAIN_ID: 11155111 } }, "~/server/db": { db }, "~/server/db/schema": tables,
    "~/server/storage/content-store": { readBlob: async (digest: string) => { const bytes = blobs.get(digest); assert.ok(bytes); return Uint8Array.from(bytes); }, putBlob: denied },
    "~/lib/unfunded-preview-replan": replan, "~/lib/unfunded-publication-deadline": deadline,
    "./unfunded-preview-replan-service": { loadSnapshot: async () => snapshot },
    "~/lib/canonical-inline-artifact": canonical, "./upload-plan-object-identity": uploadIdentity,
    "./creator-prepared-source-service": { loadOwnedStudioCreatorPreparedSource: async () => ({ artifactId: "artifact", activeRevision: pin.activeRevision, manifestDigest: pin.manifestDigest, viewer: "keel-verification-shell", release: { ...pin.release, chainId: 11155111, collectionAddress: null, controllerAddress: null } }) },
    "./inline-fragment-catalog-service": { readConfiguredInlineFragmentCatalog: async () => selectedCatalog,
      readSavedCreatorMediaSelection: () => ({ entrypointResourceId: "original", collectorImageResourceId: "poster" }) },
    "./module-binding-service": { resolveModuleBindings: async () => [] }, "./creator-prepared-source": sourceInventory,
    "./media-source-transition": mediaTransition,
    "./artifact-build-defaults-service": { readCurrentArtifactBuildDefaultsSnapshot: async () => { counters.defaults++; throw defaultsBoundary; } },
    "~/lib/creator-prepared-publication-capability": { creatorPreparedPublicationCapability: { available: false } },
  };
  const restoreExports: any = {};
  const restoreCode = ts.transpileModule(readFileSync(path.join(app, "src/server/services/unfunded-preview-replan-service.ts"), "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  vm.runInThisContext(`(function(exports,require){${restoreCode}\n})`)(restoreExports,
    (name: string) => name === "@keel/studio-core" ? core : bindings[name] ?? (name.startsWith("node:") ? require(name) : {}));
  bindings["./unfunded-preview-replan-service"] = { loadSnapshot: async () => snapshot, restorePrepared: restoreExports.restorePrepared };
  const filename = process.env.KEEL_COST_SCOPE_SOURCE_FILE ?? path.join(app, "src/server/services/saved-source-preparation-service.ts"), exports: any = {};
  const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: filename }).outputText;
  vm.runInThisContext(`(function(exports,require){${code}\n})`, { filename })(exports, (name: string) => bindings[name] ?? (name.startsWith("node:") ? require(name) : {}));
  bindings["./saved-source-preparation-service"] = exports;
  const candidateExports: any = {};
  const candidateCode = ts.transpileModule(readFileSync(path.join(app, "src/server/services/registered-inline-candidate-plan.ts"), "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  vm.runInThisContext(`(function(exports,require){${candidateCode}\n})`)(candidateExports, (name: string) => bindings[name] ?? (name.startsWith("node:") ? require(name) : {}));
  return { snapshot, journal, pin, defaultsBoundary, counters, blobs, selectedCatalog,
    planImage: (signal?: AbortSignal) => candidateExports.planCurrentFinalInlineCollectorImage({ manifest: snapshot.artifact.manifest,
      chainId: selectedCatalog.chainId, store: selectedCatalog.store, collectorImage: { resourceId: "poster", mediaType: "image/png",
        bytes: blobs.get(snapshot.resources[0].decodedBlobDigest.slice(2)) }, currentSource: { creatorId: "creator", pin }, ...(signal ? { signal } : {}) }),
    read: (signal?: AbortSignal) => exports.readOwnedInlineCandidateSource("creator", pin, { signal }),
    prepare: (owned: unknown) => exports.prepareOwnedInlineCandidateArtifact(owned, { canonicalReader: {} }, {
      generation: "097791d4-1b2d-49a4-bf13-a5a380b62b47", creatorWallet: snapshot.ownerWallet,
    }) };
}

test("creation-only current plans remain eligible for read-only cost comparison", async () => {
  const f = fixture(false); assert.equal((await f.read()).costComparisonScope, "unissued-active-generation");
});

for (const withJournal of [false, true]) {
  test(`fresh unbound artifact uses its exact selected release chain (coordinator=${withJournal})`, async () => {
    const f = fixture(withJournal); f.snapshot.artifact.chainId = null;
    const before = structuredClone(f.snapshot);
    const owned = await f.read();
    assert.equal(owned.costComparisonScope, "unissued-active-generation");
    assert.deepEqual(f.snapshot, before, "Read-only qualification must not bind or mutate the unissued artifact.");
    await assert.rejects(f.prepare(owned), error => error === f.defaultsBoundary);
    assert.equal(f.counters.defaults, 1);
  });
}

for (const [name, change] of [
  ["bound artifact on another chain", (f: ReturnType<typeof fixture>) => { f.snapshot.artifact.chainId = 1; }],
  ["unbound artifact with another release chain", (f: ReturnType<typeof fixture>) => { f.snapshot.artifact.chainId = null; f.snapshot.releases[0].chainId = 1; }],
  ["unbound artifact with no selected release chain", (f: ReturnType<typeof fixture>) => { f.snapshot.artifact.chainId = null; f.snapshot.releases[0].chainId = null; }],
  ["unbound artifact with already bound physical plan", (f: ReturnType<typeof fixture>) => { f.snapshot.artifact.chainId = null; f.snapshot.plans[0].chainId = f.selectedCatalog.chainId; }],
  ["unbound artifact with approval evidence", (f: ReturnType<typeof fixture>) => { f.snapshot.artifact.chainId = null; f.journal.approvalIssuedAt = "saved evidence"; }],
] as const) {
  test(`${name} cannot gain fresh comparison authority`, async () => {
    const f = fixture(); change(f);
    assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
    assert.equal(f.counters.defaults, 0);
  });
}

test("a persisted strictly never-issued coordinator remains eligible before any wallet handoff", async () => {
  const f = fixture(); replan.assertNeverIssued(f.journal);
  assert.equal((await f.read()).costComparisonScope, "unissued-active-generation");
});

test("an exact never-issued stage may coexist with untouched creation-only sibling plans", async () => {
  const f = fixture(); f.journal.stagePlanIds = ["manifest-plan", "plan-0"];
  f.journal.preparationPlanSnapshotDigest = deadline.unfundedDeadlinePlanIdentity(f.snapshot.plans.filter((row: any) => f.journal.stagePlanIds.includes(row.id)));
  assert.equal((await f.read()).costComparisonScope, "unissued-active-generation");
});

test("an untouched sibling cannot belong to a different valid active generation", async () => {
  const f = fixture(); f.journal.stagePlanIds = ["manifest-plan", "plan-0"];
  f.journal.preparationPlanSnapshotDigest = deadline.unfundedDeadlinePlanIdentity(f.snapshot.plans.filter((row: any) => f.journal.stagePlanIds.includes(row.id)));
  const other = "097791d4-1b2d-49a4-bf13-a5a380b62b47";
  f.snapshot.plans[1].publicationState = { ...replan.newUnissuedPublicationState(other), planGeneration: other };
  assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
});

test("an unstaged local resource cannot hide outside the authenticated active plans", async () => {
  const f = fixture(); f.snapshot.resources.push({ ...f.snapshot.resources[0], id: "unstaged", resourceId: "unstaged.bin" });
  assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
});

test("duplicate plans cannot count one local resource as two independent fresh objects", async () => {
  const f = fixture(); f.snapshot.plans.push({ ...f.snapshot.plans[0], id: "duplicate-plan" });
  assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
});

test("read-only alternate preparation accepts the same strictly never-issued persisted coordinator", async () => {
  const f = fixture(), owned = await f.read();
  await assert.rejects(f.prepare(owned), error => error === f.defaultsBoundary);
  assert.equal(f.counters.defaults, 1);
});

test("read-only alternate preparation stops for newly recorded approval evidence", async () => {
  const f = fixture(), owned = await f.read(); f.journal.approvalIssuedAt = "saved evidence";
  await assert.rejects(f.prepare(owned), /approvalIssuedAt/u);
  assert.equal(f.counters.defaults, 0);
});

for (const evidence of ["approval", "approvalIssuedAt", "approvalTransactionHash", "jobId", "fundingPreflight", "executorGasLimits", "operationBatchSize"]) {
  test(`persisted ${evidence} never grants new-cost scope`, async () => {
    const f = fixture(); f.journal[evidence] = "saved evidence";
    assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
  });
}

const faults: [string, (f: ReturnType<typeof fixture>) => void][] = [
  ["recorded transaction", f => { f.journal.transactionHashes.push(`0x${"cd".repeat(32)}`); }],
  ["recorded receipt fee", f => { f.journal.receiptFeesWei.receipt = "0"; }],
  ["saved submission", f => { f.journal.submissions.receipt = { phase: "approval" }; }],
  ["completed chunk", f => { f.journal.completedChunks = 1; }],
  ["completed operation", f => { f.journal.completedOperations = 1; }],
  ["failed chunk", f => { f.journal.failedChunkIndexes.push(0); }],
  ["failed operation", f => { f.journal.failedOperationIndexes.push(0); }],
  ...["actualTransactionFeeWei", "walletApprovalActualFeeWei", "executorActualFeeWei"].map(key => [key, (f: ReturnType<typeof fixture>) => { f.journal.quote[key] = "0"; }] as [string, (f: ReturnType<typeof fixture>) => void]),
  ["unknown journal evidence", f => { f.journal.unknownEvidence = true; }],
  ["malformed coordinator", f => { f.snapshot.plans[2].publicationState.managedPublication = null; }],
  ["nonempty history", f => { f.snapshot.plans[0].publicationState.managedPublicationHistory = [structuredClone(f.journal)]; }],
  ["malformed history", f => { f.snapshot.plans[0].publicationState.managedPublicationHistory = {}; }],
  ["unknown plan state", f => { f.snapshot.plans[0].publicationState.unknownEvidence = true; }],
  ["missing creation provenance", f => { delete f.snapshot.plans[0].publicationState.approvalBoundary; }],
  ["mismatching publication generation", f => { f.snapshot.plans[0].publicationState.publicationGeneration = "097791d4-1b2d-49a4-bf13-a5a380b62b47"; }],
  ["invalid plan generation", f => { f.snapshot.plans[0].publicationState.planGeneration = "invented"; }],
  ["completed plan", f => { f.snapshot.plans[0].status = "complete"; }],
  ["bound plan chain", f => { f.snapshot.plans[0].chainId = 11155111; }],
  ["bound plan store", f => { f.snapshot.plans[0].storeAddress = f.journal.storeAddress; }],
  ["bound plan root", f => { f.snapshot.plans[0].rootObjectId = f.journal.planDigest; }],
  ["changed physical integrity", f => { f.snapshot.plans[0].plan.integrity.digest = `0x${"ef".repeat(32)}`; }],
  ["foreign plan owner", f => { f.snapshot.plans[0].artifactId = "other"; }],
  ["detached physical resource", f => { f.snapshot.plans[0].artifactResourceId = "other"; }],
  ["uncommitted plan program", f => { f.snapshot.plans[0].plan.extraUnreviewedProgram = true; }],
  ["foreign stage plan", f => { f.journal.stagePlanIds[0] = "foreign"; }],
  ["duplicate stage plan", f => { f.journal.stagePlanIds.push(f.journal.stagePlanIds[0]); }],
  ["missing own stage plan", f => { f.journal.stagePlanIds = ["plan-0", "plan-1"]; }],
  ["foreign coordinator", f => { f.journal.coordinatorPlanId = "foreign"; }],
  ["wrong journal chain", f => { f.journal.chainId = 1; }],
  ["wrong journal store", f => { f.journal.storeAddress = `0x${"ab".repeat(20)}`; }],
  ["wrong journal owner", f => { f.journal.owner = `0x${"ab".repeat(20)}`; }],
  ["stale journal manifest", f => { f.journal.preparationManifestDigest = `0x${"ef".repeat(32)}`; }],
  ["stale journal revision", f => { f.journal.preparationArtifactRevision++; }],
  ["stale journal plan snapshot", f => { f.journal.preparationPlanSnapshotDigest = `0x${"ef".repeat(32)}`; }],
  ["published artifact", f => { f.snapshot.artifact.publishedAt = new Date(); }],
  ["registered artifact", f => { f.snapshot.artifact.registryAddress = f.journal.storeAddress; }],
  ["existing artifact token", f => { f.snapshot.artifact.tokenId = "0"; }],
  ["published revision", f => { f.snapshot.revisions[0].transactionHash = f.journal.planDigest; }],
  ["stale release revision", f => { f.snapshot.releases[0].revision++; }],
  ["existing release operation", f => { f.snapshot.releaseOperations.push({ status: "failed" }); }],
  ["authorization issuance", f => { f.snapshot.authorizationIssuances.push({}); }],
  ["publication run", f => { f.snapshot.publicationRuns.push({ status: "complete" }); }],
  ["executor transaction", f => { f.snapshot.executorTransactions.push({ status: "reverted" }); }],
  ["creator publication journal", f => { f.snapshot.creatorJournals.push({ creatorId: "creator", sourceId: "artifact" }); }],
  ["replication source", f => { f.snapshot.replicationSources.push({}); }],
];
for (const [name, change] of faults) test(`${name} remains ineligible without changing its evidence`, async () => {
  const f = fixture(); change(f); const before = replan.replanSnapshotDigest(f.snapshot);
  assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
  assert.equal(replan.replanSnapshotDigest(f.snapshot), before);
});

for (const [name, change] of faults.filter(([name]) => ["completed plan", "bound plan chain", "bound plan store", "bound plan root", "changed physical integrity", "foreign plan owner", "detached physical resource", "published artifact", "registered artifact", "existing artifact token", "published revision", "stale release revision", "existing release operation", "authorization issuance", "publication run", "executor transaction", "creator publication journal", "replication source"].includes(name))) {
  test(`creation-only state cannot hide ${name}`, async () => {
    const f = fixture(false); change(f);
    assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
  });
}

function previewCoordinator(f: ReturnType<typeof fixture>) {
  delete f.snapshot.plans[2].publicationState.managedPublication;
  f.snapshot.plans[0].publicationState.managedPublication = f.journal;
  f.journal.coordinatorPlanId = "plan-0";
}
test("the actual preview planner accepts its exact never-issued coordinator through the full source proof", async () => {
  const f = fixture(); previewCoordinator(f);
  const result = await f.planImage();
  assert.equal(result.resourceId, "poster"); assert.equal(result.disposition, "new");
  assert.deepEqual(result.bytes, Uint8Array.from(poster));
  assert.match(result.objectId, /^0x[0-9a-f]{64}$/u);
});
test("the actual preview planner rejects newly issued coordinator authority", async () => {
  const f = fixture(); previewCoordinator(f); f.journal.approvalIssuedAt = "saved evidence";
  await assert.rejects(f.planImage(), /paid, issued or unresolved/u);
});
test("the actual preview planner rejects stale owner revision pins", async () => {
  const f = fixture(); previewCoordinator(f); f.pin.activeRevision++;
  await assert.rejects(f.planImage(), /owner\/revision-bound/u);
});
test("the actual preview planner rejects a changed preview blob", async () => {
  const f = fixture(); previewCoordinator(f);
  f.blobs.get(f.snapshot.resources[0].decodedBlobDigest.slice(2))![0] ^= 1;
  await assert.rejects(f.planImage(), /owner\/revision-bound/u);
});
test("the actual preview planner retains cancellation identity", async () => {
  const f = fixture(); previewCoordinator(f); const controller = new AbortController(), reason = new Error("stop preview inspection"); controller.abort(reason);
  await assert.rejects(f.planImage(controller.signal), error => error === reason);
});
const graphFaults: [string, (f: ReturnType<typeof fixture>) => void][] = [
  ["missing manifest plan", f => { f.snapshot.plans.pop(); }],
  ["duplicate manifest plan", f => { f.snapshot.plans.push({ ...f.snapshot.plans[2], id: "extra-manifest-plan" }); }],
  ["reused shell wrong object", f => { f.selectedCatalog.compact!.shell.prefix.objectId = `0x${"ef".repeat(32)}`; }],
  ["reused shell wrong digest", f => { f.selectedCatalog.compact!.shell.prefix.digest = `0x${"ef".repeat(32)}`; }],
  ["reused shell wrong MIME", f => { f.selectedCatalog.compact!.shell.prefix.mediaType = "application/octet-stream"; }],
  ["reused shell wrong stored length", f => { f.selectedCatalog.compact!.shell.prefix.storedByteLength++; }],
  ["reused shell wrong chain", f => { f.snapshot.resources[1].chainId = 1; }],
  ["reused shell wrong store", f => { f.snapshot.resources[1].storeAddress = `0x${"ab".repeat(20)}`; }],
  ["logical asset blob corruption", f => { f.blobs.get(f.snapshot.resources[2].decodedBlobDigest.slice(2))![0] ^= 1; }],
  ["composite root paid identity", f => { Object.assign(f.snapshot.resources[5], { sourceKind: "onchain", chainId: f.selectedCatalog.chainId, storeAddress: f.selectedCatalog.store, objectId: f.journal.planDigest }); }],
  ["duplicate upload of an assembled member", f => { f.snapshot.plans.push({ ...f.snapshot.plans[0], id: "duplicate-member", resourceId: f.snapshot.resources[2].resourceId, artifactResourceId: f.snapshot.resources[2].id }); }],
];
for (const [name, change] of graphFaults) test(`the six-row current graph rejects ${name}`, async () => {
  const f = fixture(); change(f); const before = replan.replanSnapshotDigest(f.snapshot);
  assert.equal((await f.read()).costComparisonScope, "paid-reuse-evidence-required");
  assert.equal(replan.replanSnapshotDigest(f.snapshot), before);
});

test("source revision changes reject rather than returning an eligible stale source", async () => {
  const f = fixture(); f.snapshot.artifact.activeRevision++;
  await assert.rejects(f.read(), /source changed/u);
});

test("cancelled source inspection does not grant cost-comparison authority", async () => {
  const f = fixture(), controller = new AbortController(), reason = new Error("cancelled"); controller.abort(reason);
  await assert.rejects(f.read(controller.signal), error => error === reason);
});
