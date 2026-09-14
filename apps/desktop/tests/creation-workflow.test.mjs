import test from 'node:test';
import assert from 'node:assert/strict';
import { newTemplateProject, newProject, WorkspaceStore } from '../src/workspace.mjs';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { templateProject, attachArtwork, releaseDefaults, selectProjectNetwork, collectionChoices, mergeDiscoveredCollections, artworkReady, artworkIssue, collectionReady } from '../src/creation-workflow.mjs';
import { changeIntent, workPlan } from '../src/artist-workflow.mjs';

const image = { id: 'a'.repeat(64), name: 'My first artwork.gif', type: 'image/gif', byteLength: 20, source: 'local-import' };
const image2 = { ...image, id: 'b'.repeat(64), name: 'Second.png', type: 'image/png' };
const profileId = '00000000-0000-4000-8000-000000000001';
const contract = (chainId, kind = 'collection') => createTrackedContract({ chainId, address: '0x' + '1'.repeat(40), kind, name: 'Existing art', abi: [], source: 'manual' });

test('templates produce usable defaults without placeholder artwork or a selected network', () => {
  for (const template of ['image', 'edition', 'collection', 'interactive']) {
    const project = newTemplateProject('Untitled image', template);
    assert.equal(project.presentation.shell, 'canonical'); assert.equal(project.presentation.delivery, 'auto');
    assert.equal(project.creation.step, 'artwork'); assert.equal(project.intent.family, undefined);
    assert.equal(project.intent.mintSystem, 'mint-gate'); assert.deepEqual(project.intent.access, ['public']);
    assert.equal(project.intent.signature, 'none');
    assert.equal(artworkReady(project), template === 'interactive');
    if (template !== 'interactive') assert.deepEqual(project.files, []);
    else { assert.match(project.files[0].content, /from 'three'/); assert.ok(project.files[0].content.length < 5000); assert.equal(project.runtimeModules.length, 2); }
  }
});
test('image import supplies the cover, filename title, original and verified default', () => {
  const project = attachArtwork(newTemplateProject('Untitled image', 'image'), [image]);
  assert.equal(project.title, 'My first artwork'); assert.equal(project.metadata.name, project.title);
  assert.equal(project.metadata.image, `keel-asset://${image.id}/raw`); assert.equal(project.presentation.entryObjectId, image.id);
  assert.equal(project.presentation.shell, 'canonical'); assert.equal(artworkIssue(project), '');
  const second = attachArtwork({ ...project, metadata: { ...project.metadata, name: 'Artist title', image: 'ipfs://cover' }, presentation: { ...project.presentation, shell: 'none' } }, [image2]);
  assert.equal(second.title, project.title); assert.equal(second.metadata.name, 'Artist title');
  assert.equal(second.metadata.image, 'ipfs://cover'); assert.equal(second.presentation.shell, 'none');
});
test('batch collection imports persist distinct artworks, count and resume step without duplicating the cover', () => {
  const store = new WorkspaceStore(':memory:');
  let project = attachArtwork(newTemplateProject('My series', 'collection'), [image]);
  project = attachArtwork(project, [image2, image]);
  assert.deepEqual(project.creation.artworkIds, [image.id, image2.id]); assert.equal(project.intent.supply, '2');
  assert.equal(project.presentation.entryObjectId, image.id); assert.equal(project.metadata.image, `keel-asset://${image.id}/raw`);
  project.creation.step = 'collection'; project.creation.collectionName = 'Colours';
  store.save({ ...store.read().state, projects: [project], objects: [image, image2] }, 0);
  assert.deepEqual(store.read().state.projects[0], project);
  assert.throws(() => store.save({ ...store.read().state, projects: [{ ...project, objectIds: [image.id] }] }, 1), /Attach collection artwork/);
  store.close();
});
test('release defaults preserve explicit choices and never mix incompatible quantities', () => {
  const project = newTemplateProject('Edition', 'edition');
  const explicit = { ...project.intent, collection: 'tezos-fa2', family: 'tezos', network: 'NetXdQprcVkpaWU', storage: 'native', mintSystem: 'one-mint', access: undefined, signature: undefined, stages: ['allowlist', 'public'] };
  const result = releaseDefaults(explicit);
  assert.equal(result.family, 'tezos'); assert.equal(result.storage, 'native'); assert.deepEqual(result.stages, ['allowlist', 'public']);
  assert.equal(result.access, undefined); assert.equal(result.signature, undefined);
  const single = releaseDefaults({ releaseType: 'one-of-one' }, { runtime: 'static-media', releaseType: 'limited-edition', collection: 'erc1155', supply: '25' });
  assert.equal(single.supply, undefined); assert.throws(() => templateProject(newProject('x'), 'no-such-template'));
});
test('collection choices match exact network and retain distinct shared collection identities', () => {
  const a = contract(1); const b = contract(8453); const infrastructure = { ...a, id: 'factory', kind: 'default' };
  const state = { contracts: [a, b, infrastructure], collections: [] };
  assert.deepEqual(collectionChoices(state, { family: 'tezos', network: 'mainnet' }), []);
  assert.deepEqual(collectionChoices(state, { family: 'ethereum', chainId: 1 }).map(item => item.contract.id), [a.id]);
  state.collections = [1, 2].map(id => ({ id: `shared-${id}`, contractId: a.id, chainId: 1, name: `Group ${id}`, deployment: 'shared', sharedCollectionId: String(id) }));
  assert.deepEqual(collectionChoices(state, { family: 'ethereum', chainId: 1 }).map(item => item.id), ['shared-1', 'shared-2']);
});
test('network changes invalidate the old collection selection but keep contract links and explicit storage', () => {
  const project = { ...newTemplateProject('Art', 'image'), intent: { outcome: 'release', family: 'ethereum', chainId: 1, collection: 'existing', collectionAddress: contract(1).address, storage: 'native' }, contractIds: [contract(1).id] };
  project.creation.selectedCollectionId = 'shared-1';
  const same = selectProjectNetwork(project, profileId, { family: 'ethereum', chainId: 1 });
  assert.equal(same.intent.collectionAddress, project.intent.collectionAddress); assert.equal(same.creation.selectedCollectionId, 'shared-1');
  for (const snapshot of [{ family: 'ethereum', chainId: 8453 }, { family: 'tezos', network: 'NetXdQprcVkpaWU' }]) {
    const next = selectProjectNetwork(project, profileId, snapshot);
    assert.equal(next.intent.collectionAddress, undefined); assert.equal(next.creation.selectedCollectionId, undefined);
    assert.equal(next.intent.storage, 'native'); assert.deepEqual(next.contractIds, project.contractIds);
  }
  assert.equal(changeIntent(project.intent, 'chainId', 8453).collectionAddress, undefined);
});
test('steps require artwork, quantity and a named new collection; Tezos reaches its honest setup review', () => {
  let project = newTemplateProject('Edition', 'edition'); assert.ok(artworkIssue(project));
  project = attachArtwork(project, [image]); assert.equal(artworkIssue(project), '');
  assert.ok(artworkIssue({ ...project, intent: { ...project.intent, supply: undefined } }));
  assert.equal(collectionReady(project), false);
  project = selectProjectNetwork(project, profileId, { family: 'ethereum', chainId: 1 }); assert.equal(collectionReady(project), false);
  project.creation.collectionName = 'Art editions'; assert.equal(collectionReady(project), true);
  project = selectProjectNetwork(project, profileId, { family: 'tezos', network: 'NetXdQprcVkpaWU' });
  project.creation.collectionName = ''; assert.equal(collectionReady(project), true);
  const plan=workPlan(project,[image]);assert.equal(plan.intent.collection,'tezos-fa2');assert.equal(plan.modules.publicationStatus,'unverified');assert.equal(plan.authority.publicationReady,false);
});
test('discovery preserves custom contract controls and never claims account authority', () => {
  const original = { ...contract(1), name: 'My custom label', notes: 'Keep my notes' };
  const record = { collectionId: '1', sharedCollectionId: '0', name: 'Onchain name', deployment: 'dedicated', contract: contract(1) };
  const result = { chainId: 1, factory: '0x' + '2'.repeat(40), creator: '0x' + '3'.repeat(40), blockNumber: '100', infrastructure: [], records: [record] };
  const merged = mergeDiscoveredCollections({ contracts: [original], collections: [] }, [result]);
  assert.deepEqual(merged.contracts, [original]); assert.equal(merged.collections[0].observedBlock, '100');
  assert.equal(merged.contracts[0].authority, 'unverified');
});
