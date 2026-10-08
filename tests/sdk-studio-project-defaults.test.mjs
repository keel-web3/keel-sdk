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
  const current = resolveKeelBuildDefaults(profile, { mediaType: 'image/png', project: { brotliQuality: 9 }, build: { brotliQuality: 10 }, constraints: { maxReadGas: 2000000, maxOutputBytes: 2000000, transportProfiles: ['base90-v1'] } });
  assert.equal(current.values.brotliQuality, 10); assert.equal(current.sources.brotliQuality, 'build');
  assert.equal(current.values.maxReadGas, 2000000); assert.equal(current.requiresFullReadValidation, true);
  assert.equal(resolveKeelBuildDefaults(profile, { build: { payloadStorage: 'raw', compression: 'brotli' } }).values.compression, 'none');
  assert.throws(() => resolveKeelBuildDefaults(profile, { constraints: { transportProfiles: ['unknown'] } }), /registered reader/);
  assert.throws(() => updateKeelStudioDefaultProfile(profile, buildMatrix, { expectedRevision: 2, scope: { kind: 'global' }, values: { multistage: true } }), /cannot become a default/);
  assert.throws(() => resolveKeelBuildDefaults(profile, { build: { brotliQuality: 12 } }));
  assertKeelBuildDefaultsCurrent(current, current);
  assertKeelBuildDefaultsCurrent({ ...current, values: Object.fromEntries(Object.entries(current.values).reverse()) }, current);
  assert.throws(() => assertKeelBuildDefaultsCurrent(current, { ...current, revision: current.revision + 1 }), /build-defaults-stale/);
  assert.throws(() => assertKeelBuildDefaultsCurrent(current, { ...current, values: { ...current.values, maxReadGas: 1 } }), /build-defaults-stale/);
});

test('collection type filters apply by exact axes and specificity after media, before explicit build and contract caps', async () => {
 const { KEEL_BUILD_DEFAULT_FIELDS, resolveKeelBuildDefaults } = await import('../packages/sdk/dist/studio-project-defaults.js');
 const buildMatrix = { schema:'keel-studio-plan-matrix@1',capabilityRevision:'filters',fields:KEEL_BUILD_DEFAULT_FIELDS };
 let profile=createKeelStudioDefaultProfile();
 const set=(scope,values)=>{profile=updateKeelStudioDefaultProfile(profile,buildMatrix,{expectedRevision:profile.revision,scope,values});};
 set({kind:'global'},{brotliQuality:4});set({kind:'media',mediaType:'image/png'},{brotliQuality:5});
 set({kind:'collection',filter:{tokenStructure:'edition'}},{brotliQuality:6,maxReadGas:9000});
 set({kind:'collection',filter:{tokenStructure:'edition',tokenStandard:'erc721',mediaType:'image/png'}},{brotliQuality:8});
 const input={mediaType:'image/png',collection:{tokenStandard:'erc721',tokenStructure:'edition',saleMethod:'fixed-price'}};
 assert.equal(resolveKeelBuildDefaults(profile,input).values.brotliQuality,8);
 assert.equal(resolveKeelBuildDefaults(profile,input).sources.brotliQuality,'collection');
 assert.equal(resolveKeelBuildDefaults(profile,{...input,collection:{tokenStructure:'one-of-one'}}).values.brotliQuality,5);
 assert.equal(resolveKeelBuildDefaults(profile,{...input,mediaType:'image/jpeg'}).values.brotliQuality,6);
 assert.equal(resolveKeelBuildDefaults(profile,{...input,project:{brotliQuality:9},build:{brotliQuality:10},constraints:{maxReadGas:8000}}).values.brotliQuality,10);
 assert.equal(resolveKeelBuildDefaults(profile,{...input,constraints:{maxReadGas:8000}}).values.maxReadGas,8000);
 const pinned=pinKeelStudioDefaults(profile,buildMatrix,'image/png',input.collection);set({kind:'collection',filter:{tokenStructure:'edition'}},{brotliQuality:7});
 assert.equal(pinned.byMedia['image/png'].brotliQuality,8);
});
test('collection filters reject equal-specificity ambiguity, invalid axes and signing values; removing empties reclaims capacity', async()=>{
 const {validateKeelStudioDefaultsCommand}=await import('../packages/sdk/dist/studio-project-defaults.js');
 let profile=change(createKeelStudioDefaultProfile(),{kind:'collection',filter:{tokenStructure:'edition'}},{delivery:'inline'});
 assert.throws(()=>change(profile,{kind:'collection',filter:{tokenStandard:'erc721'}},{delivery:'hybrid'}),/overlap/);
 for(const filter of [{},{mediaType:'image/png'},{address:'0x123'},{tokenStructure:'other'},{tokenStandard:'none',tokenStructure:'edition'}]) assert.throws(()=>change(profile,{kind:'collection',filter},{delivery:'inline'}));
 assert.throws(()=>change(profile,{kind:'collection',filter:{tokenStructure:'edition'}},{privateKey:'secret'}),/project-specific/);
 const command={commandId:'11111111-1111-4111-8111-111111111111',expectedRevision:profile.revision,scope:{kind:'collection',filter:{tokenStructure:'edition',mediaType:'image/png'}},values:{delivery:'inline'}};
 assert.deepEqual(validateKeelStudioDefaultsCommand(command),command);
 profile=change(profile,{kind:'collection',filter:{tokenStructure:'edition'}},{delivery:null});assert.deepEqual(profile.collectionFilters,[]);
 assert.equal(parseKeelStudioDefaultProfile(createKeelStudioDefaultProfile()).collectionFilters,undefined);
});
test('named selection carries a copied collection filter snapshot and applies it only to matching new plans', async()=>{
 const {parseKeelSelectedProjectProfile,pinKeelSelectedProjectDefaults}=await import('../packages/sdk/dist/studio-project-defaults.js');
 const {KEEL_PROJECT_STARTER_PROFILES,snapshotKeelProjectProfile}=await import('../packages/sdk/dist/studio-project-profiles.js');
 const profile=change(createKeelStudioDefaultProfile(),{kind:'collection',filter:{tokenStructure:'edition',mediaType:'image/png'}},{delivery:'hybrid'});
 const selection=parseKeelSelectedProjectProfile({snapshot:snapshotKeelProjectProfile(KEEL_PROJECT_STARTER_PROFILES[1]),defaults:{revision:'copy:1',global:profile.global,byMedia:profile.byMedia,collectionFilters:profile.collectionFilters}});
 const pinned=pinKeelSelectedProjectDefaults(selection,matrix,'image/png');assert.equal(pinned.byMedia['image/png'].delivery,'hybrid');assert.equal(pinned.revision,'copy:1');
 const jpeg=pinKeelSelectedProjectDefaults(selection,matrix,'image/jpeg');assert.equal(jpeg.byMedia['image/jpeg'],undefined);
});

test('slot delivery preferences are typed intent and explicit build values override collection defaults', async()=>{
 const {KEEL_BUILD_DEFAULT_FIELDS,resolveKeelBuildDefaults}=await import('../packages/sdk/dist/studio-project-defaults.js');
 const fields={schema:'keel-studio-plan-matrix@1',capabilityRevision:'slots',fields:KEEL_BUILD_DEFAULT_FIELDS};
 const profile=updateKeelStudioDefaultProfile(createKeelStudioDefaultProfile(),fields,{expectedRevision:0,scope:{kind:'collection',filter:{tokenStructure:'edition',mediaType:'image/png'}},values:{imageDelivery:'ipfs',animationDelivery:'onchain'}});
 const input={mediaType:'image/png',collection:{tokenStructure:'edition'}};
 assert.equal(resolveKeelBuildDefaults(profile,input).values.imageDelivery,'ipfs');
 assert.equal(resolveKeelBuildDefaults(profile,{...input,build:{imageDelivery:'hosted'}}).values.imageDelivery,'hosted');
 assert.throws(()=>updateKeelStudioDefaultProfile(profile,fields,{expectedRevision:1,scope:{kind:'global'},values:{imageDelivery:'upload-now'}}));
 assert.throws(()=>change(createKeelStudioDefaultProfile(),{kind:'collection',filter:{tokenStructure:'edition'}},{releaseType:'one-of-one'}),/cannot change/);
});
test('portable defaults-edit and fresh authenticated resolution preserve collection filter scope',async()=>{
 const {createKeelStudioAgentDraftClient,executeKeelStudioAgentDraftOperation}=await import('../packages/sdk/dist/studio-agent-drafts.js');
 const {KEEL_BUILD_DEFAULT_FIELDS}=await import('../packages/sdk/dist/studio-project-defaults.js');
 const command={commandId:'11111111-1111-4111-8111-111111111111',expectedRevision:0,scope:{kind:'collection',filter:{tokenStructure:'edition',mediaType:'image/png'}},values:{imageDelivery:'ipfs'}};
 let profile=createKeelStudioDefaultProfile();const requests=[];
 const options={grantToken:'x'.repeat(48),studioUrl:'https://studio.example',fetchImplementation:async(url,init)=>{requests.push({url:String(url),...init});if(init.method==='PATCH'){const edit=JSON.parse(init.body);profile=updateKeelStudioDefaultProfile(profile,{schema:'keel-studio-plan-matrix@1',capabilityRevision:'x',fields:KEEL_BUILD_DEFAULT_FIELDS},edit);}return Response.json({schema:'keel-studio-defaults-view@1',profile,signing:'not-performed'});}};
 await executeKeelStudioAgentDraftOperation({...options,operation:'defaults-edit',defaultsCommand:command});
 const current=await createKeelStudioAgentDraftClient(options).effectiveBuildDefaults({mediaType:'image/png',collection:{tokenStructure:'edition'}});
 assert.equal(current.values.imageDelivery,'ipfs');assert.deepEqual(JSON.parse(requests[0].body),command);assert.equal(requests[1].cache,'no-store');
});

test('adding slot system defaults does not invalidate a legacy prepared snapshot with unchanged effective onchain delivery',async()=>{
 const {resolveKeelBuildDefaults,assertKeelBuildDefaultsCurrent}=await import('../packages/sdk/dist/studio-project-defaults.js');
 const current=resolveKeelBuildDefaults(createKeelStudioDefaultProfile());
 const {imageDelivery,animationDelivery,...legacyValues}=current.values;
 const legacy={...current,values:legacyValues};assert.doesNotThrow(()=>assertKeelBuildDefaultsCurrent(legacy,current));
 assert.throws(()=>assertKeelBuildDefaultsCurrent(legacy,{...current,values:{...current.values,imageDelivery:'ipfs'}}),/build-defaults-stale/);
});
