import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertKeelRetainedBuildDefaultsCurrent,
  resolveKeelBuildDefaults,
  resolveKeelRetainedBuildReadPolicy,
} from "../packages/sdk/dist/studio-project-defaults.js";
import { createKeelStudioAgentDraftClient, KeelStudioApiError } from "../packages/sdk/dist/studio-agent-drafts.js";
import { uploadKeelStudioArtifact, KeelStudioUploadError } from "../packages/sdk/dist/studio-upload.js";

// Emitted by the qualified SDK's actual resolver and draft client. These are
// synthetic compatibility fixtures, never evidence for a creator's publication.
const fixture = JSON.parse(await readFile(new URL("./fixtures/saved-release-da9b402b.json", import.meta.url), "utf8"));
const studioUrl = "https://studio.example.invalid";
const grantToken = "synthetic_" + "x".repeat(48);

// Retain the original rejected fixtures. Current policy fixtures are derived
// with only the retired transport choice replaced; actual SDK resolution still
// supplies every source/default value and provenance before the guard tests.
const currentChoices=value=>Array.isArray(value)?value.map(currentChoices):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='transportProfile'?'uri81-block-v1':key==='transportProfiles'?['uri81-block-v1']:currentChoices(item)])):value;
for (const original of fixture.policies) test(`transport eligibility and current generation keep exact review boundaries: ${original.id}`, () => {
  const before = structuredClone(original);
  if(original.saved.values.transportProfile!=='uri81-block-v1'){
    assert.throws(() => assertKeelRetainedBuildDefaultsCurrent(original.profile, { ...original.input, retained: original.saved }), /Invalid retained build policy value/);
    assert.throws(() => resolveKeelRetainedBuildReadPolicy(original.profile, { ...original.input, retained: original.saved }), /Invalid retained build policy value/);
  }else assert.deepEqual(assertKeelRetainedBuildDefaultsCurrent(original.profile,{...original.input,retained:original.saved}),original.saved);
  const profile=currentChoices(original.profile),input=currentChoices(original.input);
  const saved=resolveKeelBuildDefaults(profile,input);
  assert.deepEqual(assertKeelRetainedBuildDefaultsCurrent(profile, { ...input, retained: saved }), saved);
  const read=resolveKeelRetainedBuildReadPolicy(profile,{...input,retained:saved,constraints:{maxReadGas:2_000_000,maxOutputBytes:1_800_000}});
  assert.deepEqual(read.retained,saved);assert.equal(read.readLimits.maxReadGas,2_000_000);assert.equal(read.readLimits.maxOutputBytes,1_800_000);
  assert.equal(read.requiresFullReadValidation,true);assert.deepEqual(original,before);
});

for (const saved of fixture.reviewOperations) test(`qualified source.release uses its saved identity and wire request: ${saved.operation}`, async () => {
  const before = structuredClone(fixture.source), requests = [];
  const client = createKeelStudioAgentDraftClient({ studioUrl, grantToken, fetchImplementation: async (url, init) => {
    requests.push({ url: String(url), method: init.method ?? "GET", body: init.body ?? null });
    return Response.json(saved.response);
  } });
  const { id, revision } = fixture.source.release;
  const operationId = fixture.reviewOperations.find(item => item.operation === "resumeReview").response.preparation.operationId;
  const actual = await (saved.operation === "read" ? client.read(id)
    : saved.operation === "resumeReview" ? client.resumeReview(id, revision, operationId)
      : client[saved.operation](id, revision));
  assert.deepEqual(requests, [saved.wire]);
  assert.deepEqual(actual, saved.output);
  assert.deepEqual(fixture.source, before);
});

test("authentication and timeout on saved review retry the same operation only after an explicit call", async () => {
  const saved = fixture.reviewOperations.find(item => item.operation === "resumeReview");
  const requests = [], { id, revision } = fixture.source.release;
  const operationId = saved.response.preparation.operationId;
  const client = createKeelStudioAgentDraftClient({ studioUrl, grantToken, fetchImplementation: async (url, init) => {
    requests.push({ url: String(url), method: init.method ?? "GET", body: init.body ?? null });
    if (requests.length === 1) return Response.json({ error: "Sign in again", code: "authentication-required" }, { status: 401 });
    if (requests.length === 2) throw new DOMException("Retained request timed out", "TimeoutError");
    return Response.json(saved.response);
  } });
  await assert.rejects(client.resumeReview(id, revision, operationId), error => error instanceof KeelStudioApiError && error.status === 401);
  assert.equal(requests.length, 1);
  await assert.rejects(client.resumeReview(id, revision, operationId), { name: "TimeoutError" });
  assert.equal(requests.length, 2);
  assert.deepEqual(await client.resumeReview(id, revision, operationId), saved.output);
  assert.deepEqual(requests, [saved.wire, saved.wire, saved.wire]);
});

for (const failure of ["json-auth", "html-auth", "permission", "timeout"]) test(`original retained upload survives ${failure} without an automatic retry`, async () => {
  const bytes = new Uint8Array([0, 1, 255, 34, 92, 60, 62]);
  const formData = new FormData();
  formData.set("idempotencyKey", "same-retained-original");
  formData.set("files", new File([bytes], "original.bin", { type: "application/octet-stream" }));
  let requests = 0;
  await assert.rejects(uploadKeelStudioArtifact({ endpoint: studioUrl + "/api/artifacts", formData,
    fetchImplementation: async (_url, init) => {
      requests++; assert.equal(init.body, formData);
      if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
      if (failure === "html-auth") return new Response("<html>Sign in</html>", { status: 401 });
      return Response.json({ error: "Access required" }, { status: failure === "permission" ? 403 : 401 });
    },
  }), error => failure === "timeout" ? error.name === "TimeoutError"
    : error instanceof KeelStudioUploadError && error.status === (failure === "permission" ? 403 : 401));
  assert.equal(requests, 1);
  assert.equal(formData.get("idempotencyKey"), "same-retained-original");
  assert.deepEqual(new Uint8Array(await formData.get("files").arrayBuffer()), bytes);
});

test("a changed current saved generation remains stale while its exact current policy stays readable", () => {
  const original=fixture.policies.find(item=>item.id==='historical-system-default');
  const profile=currentChoices(original.profile),saved=resolveKeelBuildDefaults(profile,currentChoices(original.input));
  const changed={...profile,revision:profile.revision+1,global:{transportProfile:'uri81-block-v1'}};
  assert.throws(()=>assertKeelRetainedBuildDefaultsCurrent(changed,{retained:saved}),/build-defaults-stale/);
  assert.deepEqual(resolveKeelRetainedBuildReadPolicy(changed,{retained:saved}).retained,saved);
});
