import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KeelChainCapabilityError,
  assertKeelChainCapability,
  buildKeelCreatorSeedProfile,
  buildKeelTezosEntropyProfile,
  buildKeelTezosSeededCollectionFA2Storage,
  decodeKeelTezosSeedDraw,
  prepareKeelTezosCollectionOriginations,
  prepareKeelTezosSeedAction,
  resolveKeelChainCapability,
} from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const contracts = (path) => readFileSync(new URL(`../../keel-contracts/${path}`, import.meta.url), 'utf8');
const NETWORK = 'NetXdQprcVkpaWU';
const CREATOR = 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx';
const COLLECTION = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';
const PROVIDER = 'KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt';
const capabilityError = (id) => (error) => error instanceof KeelChainCapabilityError
  && error.code === 'KEEL_CHAIN_CAPABILITY_UNSUPPORTED' && error.capability === id && error.family === 'tezos';

nodeTest('the Tezos profile carries the same codes as the EVM profile', () => {
  const evm = buildKeelCreatorSeedProfile({ futureBlockReveal: false, mode: 'shared', storageOnTransfer: 'reference', sealedTransfers: 'allowed' });
  const tezos = buildKeelTezosEntropyProfile({ mode: 'shared', storageOnTransfer: 'reference', sealedTransfers: 'allowed' });
  for (const key of ['useVrf', 'lockUntilReveal', 'futureBlockDelay', 'sourceGas', 'transferStorage', 'mode']) assert.equal(String(tezos[key]), String(evm[key]), key);
  assert.equal(tezos.source, null);
  const provider = buildKeelTezosEntropyProfile({ provider: PROVIDER });
  assert.deepEqual({ ...provider }, { useVrf: true, lockUntilReveal: true, futureBlockDelay: '0', sourceGas: '0', source: PROVIDER, transferStorage: 1, mode: 1 });
});

nodeTest('future-block and Chainlink VRF raise the typed capability error on Tezos', () => {
  assert.throws(() => buildKeelTezosEntropyProfile({ reveal: 'future-block' }), capabilityError('collection.seed-future-block'));
  assert.throws(() => buildKeelTezosEntropyProfile({ futureBlockDelay: 2 }), capabilityError('collection.seed-future-block'));
  for (const kind of ['buy-credits', 'request', 'deliver']) {
    assert.throws(() => prepareKeelTezosSeedAction({ network: NETWORK, sender: CREATOR, collection: COLLECTION, action: { kind } }), capabilityError('collection.seed-chainlink-vrf'));
  }
  assert.throws(() => assertKeelChainCapability('collection.seed-future-block', 'tezos'), KeelChainCapabilityError);
  assert.equal(resolveKeelChainCapability('collection.seed-future-block', 'ethereum').supported, true);
  assert.equal(resolveKeelChainCapability('collection.seeded-mint', 'tezos').supported, true);
  assert.throws(() => prepareKeelTezosCollectionOriginations({ network: NETWORK, creator: CREATOR, maxSupply: 10, code: {}, entropyProfile: { reveal: 'future-block' } }), KeelChainCapabilityError);
});

nodeTest('the seed actions build the catalogued entrypoints', () => {
  const action = (value) => prepareKeelTezosSeedAction({ network: NETWORK, sender: CREATOR, collection: COLLECTION, action: value });
  const configure = action({ kind: 'configure', profile: { provider: PROVIDER, mode: 'shared' } });
  assert.equal(configure.operation.parameters.entrypoint, 'configure_seed_profile');
  assert.equal(JSON.stringify(configure.operation.parameters.value), JSON.stringify({ prim: 'Pair', args: [{ prim: 'True' }, { prim: 'Pair', args: [{ prim: 'True' },
    { prim: 'Pair', args: [{ int: '0' }, { prim: 'Pair', args: [{ int: '0' }, { prim: 'Pair', args: [{ prim: 'Some', args: [{ string: PROVIDER }] },
      { prim: 'Pair', args: [{ int: '1' }, { int: '0' }] }] }] }] }] }] }));
  const mint = action({ kind: 'mint', recipient: CREATOR, quantity: 2, data: '0x6b65656c' });
  assert.equal(mint.operation.parameters.entrypoint, 'strike_with_data');
  assert.equal(JSON.stringify(mint.operation.parameters.value.args[1].args[1]), JSON.stringify({ bytes: '6b65656c' }));
  assert.equal(action({ kind: 'reveal', batchId: 3 }).operation.parameters.entrypoint, 'reveal_seed_batch');
  assert.equal(configure.signing, 'not-performed');
  assert.throws(() => action({ kind: 'configure', profile: { provider: CREATOR } }), TypeError);
  assert.throws(() => action({ kind: 'configure', profile: { source: PROVIDER, sourceGas: 0 } }), RangeError);
  assert.throws(() => action({ kind: 'configure', profile: { sourceGas: 5 } }), RangeError);
});

nodeTest('the seeded storage adds the seed fields in comb order and the plan stages the profile', () => {
  const storage = buildKeelTezosSeededCollectionFA2Storage({ administrator: CREATOR, keelIndex: COLLECTION, maxSupply: 100 });
  const fields = [];
  let node = storage;
  while (node.prim === 'Pair') { fields.push(node.args[0]); node = node.args[1]; }
  fields.push(node);
  assert.equal(fields.length, 28);
  assert.deepEqual(fields[15], { int: '0' }); // seed_batch_count
  assert.deepEqual(fields[18], { prim: 'False' }); // seed_configured
  assert.deepEqual(fields[26], []); // token_seed_batch
  assert.deepEqual(fields[27], { int: '0' }); // total_reserved_capacity
  const plan = prepareKeelTezosCollectionOriginations({ network: NETWORK, creator: CREATOR, maxSupply: 10, code: {}, bindings: { index: COLLECTION, creatorProfile: COLLECTION }, entropyProfile: { mode: 'derived' } });
  assert.equal(plan.stages[1].operations[0].contract, 'KeelSeededCollectionFA2');
  assert.deepEqual(plan.stages[1].operations[0].unresolvedBindings, ['code:entropyCollection']);
  assert.equal(plan.stages[2].id, 'configure-seed-profile');
  assert.equal(plan.stages[2].operations[0].prepare.sdk, 'prepareKeelTezosSeedAction');
  assert.deepEqual(decodeKeelTezosSeedDraw(String(1n << 65n)), { provider: true, revealed: false });
  assert.deepEqual(decodeKeelTezosSeedDraw(String((1n << 65n) | (1n << 64n))), { provider: true, revealed: true });
  assert.throws(() => decodeKeelTezosSeedDraw('101'), RangeError);
});

siblingSource('the SDK profile rules match the shared profile vectors', () => {
  const fixture = JSON.parse(contracts('test/fixtures/parity/seeded-collection.json'));
  const sources = { static: PROVIDER, provider: PROVIDER, implicit: CREATOR };
  for (const { name, profile, tezos } of fixture.profiles) {
    const source = profile.source === 'none' ? undefined : sources[profile.source];
    const input = {
      reveal: profile.useVrf ? 'provider' : profile.futureBlockDelay > 0 ? undefined : 'immediate',
      ...(profile.useVrf ? { provider: source } : source === undefined ? {} : { source }),
      sourceGas: profile.sourceGas, futureBlockDelay: profile.futureBlockDelay,
      mode: profile.mode === 1 ? 'derived' : 'shared', storageOnTransfer: profile.transferStorage === 1 ? 'full-seed' : 'reference',
      sealedTransfers: profile.lockUntilReveal ? 'locked' : 'allowed',
    };
    if (profile.useVrf && source === undefined) delete input.provider;
    const run = () => buildKeelTezosEntropyProfile(input);
    if (tezos === '') {
      const built = run();
      assert.equal(built.useVrf, profile.useVrf, name);
      assert.equal(built.sourceGas, String(profile.sourceGas), name);
    } else if (tezos === 'FUTURE_BLOCK_SEED_UNAVAILABLE') assert.throws(run, capabilityError('collection.seed-future-block'), name);
    else assert.throws(run, (error) => error instanceof TypeError || error instanceof RangeError, name);
  }
});
