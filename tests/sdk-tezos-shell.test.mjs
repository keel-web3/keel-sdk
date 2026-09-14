import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { prepareKeelTezosShell, keelTezosCreatorShellId } from '../packages/sdk/dist/tezos-shell.js';
import { toolByName } from '../packages/mcp/dist/tools.js';
const base = {
  network: 'NetXdQprcVkpaWU', builder: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton',
  creator: 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb', action: 'register',
  salt: '0x'+'11'.repeat(32), prefixObjectId: '0x'+'22'.repeat(32),
  suffixObjectId: '0x'+'33'.repeat(32), metadataObjectId: '0x'+'44'.repeat(32),
};
const ID = '0xc596560a7e49549afe0ef7ed133c1422ebd53f0ddb5a6b86e4f0d0ac9c67a7f4';

test('native creator shell identity matches the SmartPy PACK golden vector', () => {
  assert.equal(keelTezosCreatorShellId(base.creator, base.salt), ID);
  assert.notEqual(keelTezosCreatorShellId('tz1burnburnburnburnburnburnburjAYjjX', base.salt), ID);
});
test('registration emits native Micheline with explicit network and sender', () => {
  const plan = prepareKeelTezosShell(base);
  assert.equal(plan.shellId, ID);
  assert.equal(plan.network, base.network);
  assert.equal(plan.expectedSender, base.creator);
  assert.equal(plan.chainReady, false);
  assert.equal(plan.submission, 'not-performed');
  assert.equal(plan.transaction.destination, base.builder);
  assert.equal(plan.transaction.amount, '0');
  assert.deepEqual(plan.transaction.parameters, {entrypoint:'register_shell', value:{prim:'Pair',args:[{bytes:'11'.repeat(32)},{prim:'Pair',args:[{bytes:'22'.repeat(32)},{prim:'Pair',args:[{bytes:'33'.repeat(32)},{prim:'Pair',args:[{int:'0'},{bytes:'44'.repeat(32)}]}]}]}]}});
});
test('updates retain identity; freeze cannot carry replacement bytes', () => {
  const { salt, ...input } = base;
  const update = prepareKeelTezosShell({...input, action:'update', shellId:ID, payloadMode:'pre-encoded-graph'});
  assert.equal(update.transaction.parameters.entrypoint, 'update_shell');
  assert.equal(update.shellId, ID);
  const freeze = prepareKeelTezosShell({network:base.network,builder:base.builder,creator:base.creator,action:'freeze',shellId:ID});
  assert.deepEqual(freeze.transaction.parameters,{entrypoint:'freeze_shell',value:{bytes:ID.slice(2)}});
  assert.throws(()=>prepareKeelTezosShell({...input,action:'freeze',shellId:ID}), /Freeze does not accept/);
});
test('rejects cross-family identities, bad checksums and malformed actions', () => {
  for (const patch of [
    {network:'1'}, {network:'NetXdQprcVkpaWV'}, {builder:base.creator},
    {creator:'0x'+'11'.repeat(20)}, {creator:base.creator.slice(0,-1)+'a'},
    {salt:'0x12'}, {prefixObjectId:'0x'+'00'.repeat(32)}, {payloadMode:'unknown'},
    {action:'originate'}, {shellId:ID}, {chainId:1},
  ]) assert.throws(()=>prepareKeelTezosShell({...base,...patch}), TypeError);
});
test('MCP exposes exactly the same review-only native preparation', async () => {
  const tool = toolByName('keel-tezos-shell-prepare');
  assert.ok(tool);
  assert.deepEqual(await tool.run({},base),prepareKeelTezosShell(base));
  await assert.rejects(tool.run({}, {...base, network:'1'}), TypeError);
});
test('MCP exposes the receipt-bound standard Tezos publication call adapter', async () => {
  const tool = toolByName('keel-tezos-publication-prepare');
  assert.ok(tool);
  const result = await tool.run({}, { network: 'NetXsqzbfFenSTS', creator: 'tz1WKJQZ88sbVJFxQTNjZFPVHd7k6KKx9nzM', action: 'strike', collection: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton', quantity: 1 });
  assert.equal(result.schema, 'keel.tezos.publication-call-prepare@1');
  assert.equal(result.status, 'review-only');
  assert.equal(result.operation.parameters.entrypoint, 'strike');
  assert.equal(result.signing, 'not-performed');
  await assert.rejects(tool.run({}, { network: 'NetXsqzbfFenSTS', creator: 'tz1WKJQZ88sbVJFxQTNjZFPVHd7k6KKx9nzM', action: 'strike', collection: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton', mnemonic: 'never' }), /Unsupported|quantity|secret|private signer/iu);
});
test('MCP exposes the public FA2 metadata path and separate KEEL JSON compatibility path', async () => {
  const tool = toolByName('keel-tezos-publication-prepare');
  const standardUri = 'onchfs://' + '11'.repeat(32);
  const metadata = await tool.run({}, {
    network: 'NetXsqzbfFenSTS', creator: 'tz1WKJQZ88sbVJFxQTNjZFPVHd7k6KKx9nzM', action: 'set-token-metadata',
    collection: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton', tokenId: 1,
    tokenInfo: { '': standardUri, animation_url: standardUri, artifactUri: standardUri },
  });
  assert.equal(metadata.operation.parameters.entrypoint, 'set_token_metadata');
  assert.equal(metadata.operation.parameters.value.args?.[1]?.find((entry) => entry.args?.[0]?.string === 'animation_url')?.args?.[1]?.bytes, Buffer.from(standardUri).toString('hex'));
  const json = await tool.run({}, {
    network: 'NetXsqzbfFenSTS', creator: 'tz1WKJQZ88sbVJFxQTNjZFPVHd7k6KKx9nzM', action: 'set-token-json',
    collection: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton', tokenJson: JSON.stringify({ animation_url: standardUri }),
  });
  assert.equal(json.operation.parameters.entrypoint, 'set_token_json');
  const freeze = await tool.run({}, {
    network: 'NetXsqzbfFenSTS', creator: 'tz1WKJQZ88sbVJFxQTNjZFPVHd7k6KKx9nzM', action: 'freeze-token-metadata',
    collection: 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton', tokenId: 1,
  });
  assert.equal(freeze.operation.parameters.entrypoint, 'freeze_token_metadata');
});
test('native adapter bundles for a browser without Node built-ins', async () => {
  const built = await build({entryPoints:[new URL('../packages/sdk/src/tezos-shell.ts',import.meta.url).pathname],bundle:true,platform:'browser',format:'esm',write:false});
  const source = built.outputFiles[0].text;
  assert.doesNotMatch(source,/from ["']node:/u);
  const browser = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.deepEqual(browser.prepareKeelTezosShell(base),prepareKeelTezosShell(base));
});
