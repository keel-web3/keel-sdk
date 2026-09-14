import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEL_ENGINE_CHOICES } from '@keel/sdk/engine';
import { newProject, WorkspaceStore } from '../src/workspace.mjs';
import { exportWorkspace, inspectArchive, mergeArchive } from '../src/workspace-exchange.mjs';
import { artistOptions, changeIntent, releaseSteps, workPlan, matchesArtwork } from '../src/artist-workflow.mjs';
import { parseMetadata, metadataDocument, metadataChecks, projectCover, readinessRating, exactIndexMatches } from '../src/metadata.mjs';
const image = { id: 'a'.repeat(64), name: 'art.gif', type: 'image/gif', byteLength: 40 };
test('every supported SDK choice has artist copy without hiding advanced methods', () => {
  for (const key of Object.keys(KEEL_ENGINE_CHOICES)) {
    assert.deepEqual(artistOptions(key).map((item) => item.value), [...KEEL_ENGINE_CHOICES[key]]);
    assert.ok(artistOptions(key).every((item) => item.title && item.description));
  }
});
test('wizard retains explicit chain/storage choices and clears only incompatible decisions', () => {
  let intent = { outcome: 'release', family: 'tezos', network: 'ghostnet', storage: 'native', mintSystem: 'one-mint', stages: ['allowlist', 'public'] };
  intent = changeIntent(intent, 'mintSystem', 'mint-gate');
  assert.equal(intent.stages, undefined); assert.equal(intent.family, 'tezos'); assert.equal(intent.storage, 'native');
  intent = changeIntent(intent, 'access', ['allowlist', 'erc721']); intent = changeIntent(intent, 'gateLogic', 'any');
  intent = changeIntent(intent, 'access', ['public']); assert.equal(intent.gateLogic, undefined);
  intent = changeIntent(intent, 'outcome', 'explore'); assert.equal(intent.mintSystem, undefined); assert.equal(intent.storage, 'native');
  assert.throws(() => changeIntent(intent, 'chainId', -1));
});
test('local projects skip release-only steps and imported media plans use the displayed file', () => {
  const project = newProject('A film');
  assert.deepEqual(releaseSteps(project), ['work', 'audience', 'review']);
  const changed = { ...project, presentation: { ...project.presentation, entryObjectId: image.id } };
  assert.equal(workPlan(changed, [image]).intent.runtime, 'static-media');
  assert.equal(changed.intent.runtime, 'html');
  assert.doesNotThrow(() => workPlan({ ...changed, title: '' }, [image]), 'Temporarily clearing a project name must not crash the editor.');
  assert.ok(releaseSteps({ ...project, intent: { outcome: 'release' } }).includes('collecting'));
});
test('metadata preserves custom fields, typed traits and export names', () => {
  const metadata = parseMetadata({ image: 'ipfs://example', attributes: [{ trait_type: 'Edition', value: 7, display_type: 'number' }, { value: false }], properties: { custom: ['kept', 2] } });
  assert.equal(metadata.attributes[0].value, 7); assert.deepEqual(metadata.properties.custom, ['kept', 2]);
  assert.equal(metadataDocument({ title: 'Untitled', metadata: { name: 'Real title' } }).name, 'Real title');
  assert.throws(() => parseMetadata('[]'), /JSON object/); assert.throws(() => parseMetadata({ image: 42 }), /image must be text/);
  assert.throws(() => parseMetadata({ attributes: [{ value: {} }] }), /value/);
});
test('metadata cover takes priority, safe local files are fallback, and unsafe URIs never execute', () => {
  const project = { ...newProject('Cover'), objectIds: [image.id] };
  assert.match(projectCover(project, [image]).src, /^keel-asset:/);
  assert.match(projectCover({ ...project, metadata: { image: './art.gif' } }, [image]).src, /^keel-asset:/);
  assert.equal(projectCover({ ...project, objectIds: [], metadata: { image: 'art.gif' } }, [image]).src, undefined, 'A name must not select another project’s file.');
  const uri = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';
  assert.equal(projectCover({ ...project, metadata: { image: uri } }, [image]).src, uri);
  assert.equal(projectCover({ ...project, metadata: { image: 'javascript:alert(1)' } }, [image]).src, undefined);
  assert.equal(projectCover({ ...project, metadata: { image: 'data:text/html,<script>bad()</script>' } }, [image]).src, undefined);
  assert.equal(projectCover({ ...project, metadata: { image: 'https://example.com/art.png' } }, [image]).kind, 'remote');
});
test('ratings retain unknown preservation and flag local cover references before publication', () => {
  const project = { ...newProject('Rated'), metadata: { description: 'A work', image: `keel-asset://${image.id}/raw` }, objectIds: [image.id] };
  const checks = metadataChecks(project, [image]);
  assert.equal(checks.find((item) => item.id === 'references').status, 'attention');
  assert.equal(checks.find((item) => item.id === 'dependencies').status, 'unknown');
  assert.ok(readinessRating(checks).passed < readinessRating(checks).total);
  assert.equal(metadataChecks({ ...project, metadata: { image: 'https://example.com/cover.png' } }).find((item) => item.id === 'cover').status, 'unknown');
});
test('project search uses artist metadata and names instead of hidden code', () => {
  const project = { ...newProject('Quiet'), metadata: { description: 'Blue flowers' }, listing: { artist: 'Avery', tags: ['painting'] } };
  assert.equal(matchesArtwork(project, 'avery'), true); assert.equal(matchesArtwork(project, 'flowers'), true);
  assert.equal(matchesArtwork(project, 'place-items:center'), false);
});
test('index candidates require exact file identities and do not imply public listing', () => {
  const project = { objectIds: [image.id] };
  const result = { library: [{ name: 'art.gif' }, { sha256: `0x${image.id}` }, { digest: 'b'.repeat(64) }], modules: [] };
  assert.equal(exactIndexMatches(result, project).length, 1);
  assert.equal(exactIndexMatches(undefined, project).length, 0);
});
test('older workspaces gain metadata defaults and portable archives retain metadata and token targets', () => {
  const store = new WorkspaceStore(':memory:'); const destination = new WorkspaceStore(':memory:');
  try {
    const original = newProject('Archive'); delete original.metadata; delete original.listing;
    const saved = store.save({ ...store.read().state, projects: [original] }, 0);
    assert.deepEqual(saved.state.projects[0].metadata, {});
    assert.equal(saved.state.projects[0].listing.discoverability, 'undecided');
    const project = { ...saved.state.projects[0], metadata: { name: 'Collector title', attributes: [{ value: 4 }], custom: { keep: true } }, publication: { chainId: 1, standard: 'erc721', tokenId: '0', contractAddress: '0x' + '1'.repeat(40) } };
    store.save({ ...saved.state, projects: [project] }, 1);
    const merged = mergeArchive(destination, inspectArchive(exportWorkspace(store)), 0);
    assert.deepEqual(merged.state.projects[0].metadata, project.metadata);
    assert.deepEqual(merged.state.projects[0].publication, project.publication);
    assert.notEqual(merged.state.projects[0].id, project.id);
  } finally { store.close(); destination.close(); }
});
test('shared contracts can be linked to several projects while unknown links are rejected', async () => {
  const { createTrackedContract } = await import('@keel/sdk/contract-controls');
  const contract = createTrackedContract({ name: 'Shared editions', kind: 'collection', source: 'manual', chainId: 1, address: '0x' + '1'.repeat(40), abi: [] });
  const store = new WorkspaceStore(':memory:');
  try {
    const projects = ['First', 'Second'].map((name) => ({ ...newProject(name), contractIds: [contract.id] }));
    const saved = store.save({ ...store.read().state, contracts: [contract], projects }, 0);
    assert.equal(saved.state.projects[0].contractIds[0], saved.state.projects[1].contractIds[0]);
    assert.throws(() => store.save({ ...saved.state, contracts: [] }, 1), /not tracked/);
    assert.throws(() => store.save({ ...saved.state, projects: [{ ...projects[0], contractIds: [contract.id, contract.id] }] }, 1), /Duplicate project contract/);
  } finally { store.close(); }
});
