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
