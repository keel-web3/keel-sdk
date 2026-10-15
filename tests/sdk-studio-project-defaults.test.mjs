import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeelStudioDefaultProfile, parseKeelStudioDefaultProfile, updateKeelStudioDefaultProfile, pinKeelStudioDefaults } from '../packages/sdk/dist/studio-project-defaults.js';
import { createKeelStudioPlan, resolveKeelStudioPlan } from '../packages/sdk/dist/studio-project-planner.js';
const choice = value => ({ value, label: value, status: 'available' });
const matrix = { schema: 'keel-studio-plan-matrix@1', capabilityRevision: 'test', fields: [
  { id: 'title', label: 'Title', kind: 'text', required: true },
  { id: 'delivery', label: 'Delivery', kind: 'choice', choices: [choice('inline'), choice('hybrid'), { value: 'ipfs', label: 'IPFS', status: 'unsupported' }], required: true, allowDefault: true },
  { id: 'revisioned', label: 'Can this resource change?', kind: 'boolean', required: true, allowDefault: true, defaultMediaType: 'text/css' },
] };
const change = (profile, scope, values, extra = {}) => updateKeelStudioDefaultProfile(profile, matrix, { expectedRevision: profile.revision, scope, values, ...extra });
const plan = defaults => createKeelStudioPlan(matrix, { id: 'plan', projectId: 'project', mode: 'guided', mediaType: 'image/png', resources: [], answers: { title: 'Work' }, defaults });
test('explicit defaults are off by default and media scope overrides global without crossing into other media', () => {
  let profile = createKeelStudioDefaultProfile();
  assert.equal(profile.askToSave, false);
  profile = change(profile, { kind: 'global' }, { delivery: 'hybrid' });
  profile = change(profile, { kind: 'media', mediaType: 'image/png' }, { delivery: 'inline' });
  profile = change(profile, { kind: 'media', mediaType: 'text/css' }, { revisioned: true });
  const pinned = pinKeelStudioDefaults(profile, matrix, 'image/png');
  const resolved = resolveKeelStudioPlan(matrix, plan(pinned));
  assert.equal(resolved.answers.delivery, 'inline'); assert.equal(resolved.answers.revisioned, true);
  assert.equal(pinKeelStudioDefaults(profile, matrix, 'image/jpeg').byMedia['image/png'], undefined);
  assert.equal(resolveKeelStudioPlan(matrix, { ...plan(pinned), answers: { title: 'Work', delivery: 'hybrid' } }).answers.delivery, 'hybrid');
});
test('changing a saved profile never changes existing pinned plans; invalidated capabilities reopen questions', () => {
  let profile = change(createKeelStudioDefaultProfile(), { kind: 'global' }, { delivery: 'inline' });
  const existing = plan(pinKeelStudioDefaults(profile, matrix, 'image/png'));
  profile = change(profile, { kind: 'global' }, { delivery: 'hybrid' });
  assert.equal(resolveKeelStudioPlan(matrix, existing).answers.delivery, 'inline');
  const updatedMatrix = { ...matrix, fields: matrix.fields.map(field => field.id === 'delivery' ? { ...field, choices: [choice('hybrid')] } : field) };
  assert.equal(resolveKeelStudioPlan(updatedMatrix, existing).nextQuestion.id, 'delivery');
  assert.throws(() => updateKeelStudioDefaultProfile(profile, matrix, { expectedRevision: 1, scope: { kind: 'global' }, values: { delivery: 'inline' } }), /defaults-conflict/u);
});
test('saving requires a defaultable field and supported value, never arbitrary authority or project identity', () => {
  const profile = createKeelStudioDefaultProfile();
  for (const values of [{ title: 'All titles' }, { wallet: 'sign' }, { delivery: 'ipfs' }, { revisioned: 'yes' }]) {
    assert.throws(() => change(profile, { kind: 'global' }, values));
  }
  assert.throws(() => change(profile, { kind: 'media', mediaType: '*' }, { delivery: 'inline' }));
  const saved = change(profile, { kind: 'global' }, { delivery: 'inline' }, { askToSave: true });
  const cleared = change(saved, { kind: 'global' }, { delivery: null });
  assert.equal(cleared.global.delivery, undefined); assert.equal(cleared.askToSave, true);
});
test('untrusted profiles are bounded and copied; unknown saved keys never enter a project', () => {
  const input = { ...createKeelStudioDefaultProfile(), global: { delivery: 'inline', unknown: 'credential-like-value' } };
  const parsed = parseKeelStudioDefaultProfile(input); input.global.delivery = 'hybrid';
  assert.equal(parsed.global.delivery, 'inline'); assert.equal(pinKeelStudioDefaults(parsed, matrix, 'image/png').global.unknown, undefined);
  assert.equal(change(parsed, { kind: 'global' }, { unknown: null }).global.unknown, undefined);
  assert.throws(() => parseKeelStudioDefaultProfile({ ...input, global: Object.fromEntries(Array.from({ length: 5 }, (_, index) => ['setting' + index, '€'.repeat(7000)])) }), /profile size/u);
  for (const invalid of [{ ...input, revision: -1 }, { ...input, askToSave: 'yes' }, { ...input, byMedia: { '*': {} } }, { ...input, global: { value: Infinity } }, { ...input, extra: true }]) assert.throws(() => parseKeelStudioDefaultProfile(invalid));
});

test('integer defaults respect answer-derived bounds before a project can become ready', () => {
  const limits = { schema: 'keel-studio-plan-matrix@1', capabilityRevision: 'limits', fields: [
    { id: 'wallet', label: 'Wallet limit', kind: 'integer', minimum: 1, required: true, allowDefault: true },
    { id: 'purchase', label: 'Purchase limit', kind: 'integer', minimum: 1, maximumFrom: 'wallet', required: true, allowDefault: true },
  ] };
  const current = createKeelStudioPlan(limits, { id: 'plan', projectId: 'project', mode: 'guided', mediaType: 'image/png', resources: [], answers: {}, defaults: { revision: '1', global: { wallet: 2, purchase: 5 } } });
  const resolved = resolveKeelStudioPlan(limits, current);
  assert.equal(resolved.answers.wallet, 2); assert.equal(resolved.answers.purchase, undefined); assert.equal(resolved.nextQuestion.id, 'purchase');
});

test('portable draft client uses the same typed preferences API without broadening grants or accepting signing fields', async () => {
  const { createKeelStudioAgentDraftClient, executeKeelStudioAgentDraftOperation } = await import('../packages/sdk/dist/studio-agent-drafts.js');
  const requests = [], command = { commandId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, scope: { kind: 'media', mediaType: 'image/png' }, values: { delivery: 'inline' } };
  const options = { grantToken: 'x'.repeat(48), studioUrl: 'https://studio.example', fetchImplementation: async (url, init) => {
    requests.push({ url: String(url), ...init });
    return Response.json({ schema: 'keel-studio-defaults-view@1', profile: createKeelStudioDefaultProfile(), signing: 'not-performed' });
  } };
  const client = createKeelStudioAgentDraftClient(options);
  await client.defaults(); await client.editDefaults(command); await executeKeelStudioAgentDraftOperation({ ...options, operation: 'defaults' });
  assert.equal(requests.length, 3); assert.ok(requests.every(request => request.url === 'https://studio.example/api/agent/project-defaults'));
  assert.equal(requests[1].method, 'PATCH'); assert.deepEqual(JSON.parse(requests[1].body), command);
  await assert.rejects(client.editDefaults({ ...command, wallet: 'sign' }), /bounded defaults edit/u);
  await assert.rejects(client.editDefaults({ ...command, scope: { kind: 'global', owner: 'other' } }), /exact media/u);
  assert.equal(requests.length, 3);
  const effective = await client.effectiveBuildDefaults({ build: { brotliQuality: 4 } });
  assert.equal(effective.values.brotliQuality, 4); assert.equal(requests[3].cache, 'no-store');
  const denied = createKeelStudioAgentDraftClient({ ...options, fetchImplementation: async () => Response.json({ error: 'preferences:write required' }, { status: 403 }) });
  await assert.rejects(denied.editDefaults(command), /preferences:write/u);
});


test('removing the last media value reclaims capacity, including older invisible empty buckets', () => {
  let profile = createKeelStudioDefaultProfile();
  for (let index = 0; index < 32; index++) {
    const scope = { kind: 'media', mediaType: 'image/x-example-' + index };
    profile = change(profile, scope, { delivery: 'inline' });
    profile = change(profile, scope, { delivery: null });
  }
  assert.deepEqual(profile.byMedia, {});
  profile = change(profile, { kind: 'media', mediaType: 'image/png' }, { delivery: 'inline' });
  assert.equal(profile.byMedia['image/png'].delivery, 'inline');
  const old = { ...createKeelStudioDefaultProfile(), byMedia: Object.fromEntries(Array.from({ length: 32 }, (_, index) => ['image/x-old-' + index, {}])) };
  const saved = change(old, { kind: 'media', mediaType: 'image/jpeg' }, { delivery: 'hybrid' });
  assert.deepEqual(Object.keys(saved.byMedia), ['image/jpeg']);
});

test('fresh build defaults layer explicit overrides, hard reader bounds and Raw semantics', async () => {
  const { KEEL_BUILD_DEFAULT_FIELDS, resolveKeelBuildDefaults, assertKeelBuildDefaultsCurrent } = await import('../packages/sdk/dist/studio-project-defaults.js');
  const buildMatrix = { schema: 'keel-studio-plan-matrix@1', capabilityRevision: 'build', fields: KEEL_BUILD_DEFAULT_FIELDS };
  let profile = updateKeelStudioDefaultProfile(createKeelStudioDefaultProfile(), buildMatrix, { expectedRevision: 0, scope: { kind: 'global' }, values: { compression: 'brotli', brotliQuality: 7, maxReadGas: 9000000 } });
  profile = updateKeelStudioDefaultProfile(profile, buildMatrix, { expectedRevision: 1, scope: { kind: 'media', mediaType: 'image/png' }, values: { brotliQuality: 8 } });
  const current = resolveKeelBuildDefaults(profile, { mediaType: 'image/png', project: { brotliQuality: 9 }, build: { brotliQuality: 10 }, constraints: { maxReadGas: 2000000, maxOutputBytes: 2000000, transportProfiles: ['uri81-block-v1'] } });
  assert.equal(current.values.brotliQuality, 10); assert.equal(current.sources.brotliQuality, 'build');
  assert.equal(current.values.transportProfile, "uri81-block-v1"); assert.equal(current.values.maxReadGas, 2000000); assert.equal(current.requiresFullReadValidation, true);
  assert.equal(resolveKeelBuildDefaults(profile, { build: { payloadStorage: 'raw', compression: 'brotli' } }).values.compression, 'none');
  assert.throws(() => resolveKeelBuildDefaults(profile, { constraints: { transportProfiles: ['unknown'] } }), /registered reader/);
  assert.throws(() => updateKeelStudioDefaultProfile(profile, buildMatrix, { expectedRevision: 2, scope: { kind: 'global' }, values: { multistage: true } }), /cannot become a default/);
  assert.throws(() => resolveKeelBuildDefaults(profile, { build: { brotliQuality: 12 } }));
  assertKeelBuildDefaultsCurrent(current, current);
  assertKeelBuildDefaultsCurrent({ ...current, values: Object.fromEntries(Object.entries(current.values).reverse()) }, current);
  assert.throws(() => assertKeelBuildDefaultsCurrent(current, { ...current, revision: current.revision + 1 }), /build-defaults-stale/);
  assert.throws(() => assertKeelBuildDefaultsCurrent(current, { ...current, values: { ...current.values, maxReadGas: 1 } }), /build-defaults-stale/);
});

test('retained read policy preserves exact old source choices while layering only current read limits', async () => {
  const { resolveKeelBuildDefaults, resolveKeelRetainedBuildReadPolicy, assertKeelBuildDefaultsCurrent } = await import('../packages/sdk/dist/studio-project-defaults.js');
  const profile = { ...createKeelStudioDefaultProfile(), revision: 9,
    global: { transportProfile: 'base90-v1', compression: 'brotli', maxReadGas: 50_000_000 },
    byMedia: { 'image/png': { transportProfile: 'base90-v1', maxOutputBytes: 1_900_000 } } };
  const modern = resolveKeelBuildDefaults(createKeelStudioDefaultProfile());
  const retained = { ...modern, revision: 2, values: { ...modern.values, transportProfile: 'base90-v1', compression: 'none', payloadStorage: 'raw' },
    sources: { ...modern.sources, transportProfile: 'system', compression: 'project', payloadStorage: 'project' } };
  const before = structuredClone(retained), layers = { retained, mediaType: 'image/png',
    project: { transportProfile: 'base90-v1', maxReadGas: 40_000_000 }, build: { compression: 'none', maxOutputBytes: 1_800_000 },
    constraints: { maxReadGas: 30_000_000, maxOutputBytes: 2_000_000 } };
  const result = resolveKeelRetainedBuildReadPolicy(profile, layers);
  assert.equal(result.schema, 'keel-retained-build-read-policy@1');
  assert.equal(result.currentRevision, 9); assert.equal(result.requiresFullReadValidation, true);
  assert.deepEqual(result.retained, before); assert.deepEqual(retained, before);
  assert.deepEqual(result.readLimits, { rpcMaxConcurrentReads: modern.values.rpcMaxConcurrentReads, maxReadGas: 30_000_000, maxOutputBytes: 1_800_000 });
  assert.equal(result.readSources.maxReadGas, 'contract'); assert.equal(result.readSources.maxOutputBytes, 'build');
  assert.match(result.retainedPolicyDigest, /^0x[0-9a-f]{64}$/);
  const reordered = { ...retained, values: Object.fromEntries(Object.entries(retained.values).reverse()), sources: Object.fromEntries(Object.entries(retained.sources).reverse()) };
  assert.equal(resolveKeelRetainedBuildReadPolicy(profile, { ...layers, retained: reordered }).retainedPolicyDigest, result.retainedPolicyDigest);
  assert.notEqual(resolveKeelRetainedBuildReadPolicy(profile, { ...layers, retained: { ...retained, sources: { ...retained.sources, transportProfile: 'project' } } }).retainedPolicyDigest, result.retainedPolicyDigest);
  retained.values.transportProfile = 'uri81-block-v1';
  assert.equal(result.retained.values.transportProfile, 'base90-v1', 'saved snapshot is copied before returning');
  assert.throws(() => assertKeelBuildDefaultsCurrent(before, modern), /build-defaults-stale/);
  assert.throws(() => resolveKeelBuildDefaults(profile), TypeError);
});

test('read-only legacy compatibility never offers retired formats for fresh preparation or fabricates a missing snapshot', async () => {
  const { KEEL_BUILD_DEFAULT_FIELDS, resolveKeelBuildDefaults, resolveKeelRetainedBuildReadPolicy } = await import('../packages/sdk/dist/studio-project-defaults.js');
  const empty = createKeelStudioDefaultProfile();
  assert.deepEqual(KEEL_BUILD_DEFAULT_FIELDS.find(field => field.id === 'transportProfile').choices.map(choice => choice.value), ['uri81-block-v1']);
  for (const [profile, input] of [
    [{ ...empty, global: { transportProfile: 'base90-v1' } }, {}],
    [{ ...empty, byMedia: { 'image/png': { transportProfile: 'base90-v1' } } }, { mediaType: 'image/png' }],
    [empty, { project: { transportProfile: 'base90-v1' } }],
    [empty, { build: { transportProfile: 'base90-v1' } }],
  ]) {
    assert.throws(() => resolveKeelBuildDefaults(profile, input));
    const read = resolveKeelRetainedBuildReadPolicy(profile, input);
    assert.equal(read.retained, null); assert.equal(read.retainedPolicyDigest, null);
    assert.equal(read.readLimits.transportProfile, undefined); assert.equal(read.readLimits.compression, undefined);
  }
});

test('retained policy rejects corrupt snapshots, provenance and read bounds without rewriting them', async () => {
  const { resolveKeelBuildDefaults, resolveKeelRetainedBuildReadPolicy } = await import('../packages/sdk/dist/studio-project-defaults.js');
  const empty = createKeelStudioDefaultProfile(), valid = resolveKeelBuildDefaults(empty);
  for (const retained of [
    { ...valid, schema: 'unverified' }, { ...valid, revision: -1 }, { ...valid, requiresFullReadValidation: false },
    { ...valid, values: { ...valid.values, transportProfile: 'invented-native-route' } },
    { ...valid, values: { ...valid.values, transportProfile: ['base90-v1'] } },
    { ...valid, values: { ...valid.values, maxReadGas: 0 } },
    { ...valid, sources: { ...valid.sources, transportProfile: 'wallet' } },
    { ...valid, sources: { ...valid.sources, transportProfile: ['system'] } },
    { ...valid, sources: {} }, { ...valid, signing: 'allowed' },
  ]) {
    const before = structuredClone(retained);
    assert.throws(() => resolveKeelRetainedBuildReadPolicy(empty, { retained }));
    assert.deepEqual(retained, before);
  }
  for (const input of [{ project: { maxReadGas: 0 } }, { build: { rpcMaxConcurrentReads: 65 } }, { constraints: { maxOutputBytes: Infinity } }]) {
    assert.throws(() => resolveKeelRetainedBuildReadPolicy(empty, input));
  }
});

test('retained generation tolerates only the unchanged historical system transport default', async () => {
  const { resolveKeelBuildDefaults, assertKeelRetainedBuildDefaultsCurrent } = await import('../packages/sdk/dist/studio-project-defaults.js');
  const empty = createKeelStudioDefaultProfile(), modern = resolveKeelBuildDefaults(empty);
  const saved = { ...modern, values: { ...modern.values, transportProfile: 'base90-v1' } };
  const result = assertKeelRetainedBuildDefaultsCurrent(empty, { retained: saved });
  assert.deepEqual(result, saved); assert.notEqual(result, saved);
  assert.equal(resolveKeelBuildDefaults(empty).values.transportProfile, 'uri81-block-v1');
  for (const [profile, layer] of [
    [{ ...empty, revision: 1 }, {}],
    [{ ...empty, global: { transportProfile: 'uri81-block-v1' } }, {}],
    [empty, { project: { transportProfile: 'uri81-block-v1' } }],
    [empty, { build: { compression: 'none' } }],
    [empty, { build: { brotliQuality: 10 } }],
    [empty, { constraints: { maxReadGas: 30_000_000 } }],
    [empty, { project: { transportProfile: 'base90-v1' } }],
  ]) assert.throws(() => assertKeelRetainedBuildDefaultsCurrent(profile, { retained: saved, ...layer }), /build-defaults-stale/);
});

test('retained generation validates exact legacy account, media, project and build choices without exposing fresh availability', async () => {
  const { resolveKeelBuildDefaults, assertKeelRetainedBuildDefaultsCurrent } = await import('../packages/sdk/dist/studio-project-defaults.js');
  const empty = createKeelStudioDefaultProfile(), modern = resolveKeelBuildDefaults(empty);
  for (const source of ['account', 'media', 'project', 'build']) {
    const saved = { ...modern, revision: 3, values: { ...modern.values, transportProfile: 'base90-v1' }, sources: { ...modern.sources, transportProfile: source } };
    const profile = { ...empty, revision: 3, ...(source === 'account' ? { global: { transportProfile: 'base90-v1' } } : {}),
      ...(source === 'media' ? { byMedia: { 'image/png': { transportProfile: 'base90-v1' } } } : {}) };
    const layers = { mediaType: 'image/png', ...(source === 'project' ? { project: { transportProfile: 'base90-v1' } } : {}),
      ...(source === 'build' ? { build: { transportProfile: 'base90-v1' } } : {}) };
    assert.deepEqual(assertKeelRetainedBuildDefaultsCurrent(profile, { retained: saved, ...layers }), saved);
    assert.throws(() => resolveKeelBuildDefaults(profile, layers));
    assert.throws(() => assertKeelRetainedBuildDefaultsCurrent(profile, { retained: saved, ...layers, build: { transportProfile: 'uri81-block-v1' } }), /build-defaults-stale/);
  }
});
