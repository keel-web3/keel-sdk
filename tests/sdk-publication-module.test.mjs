import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEL_MODULES } from '../packages/sdk/src/modules.generated.ts';
import { ABI_CONTRACTS } from '../packages/sdk/src/abis.generated.ts';
import { ABIS as publication } from '../packages/sdk/src/abis/keel-publication.generated.ts';
import { ABIS as bridge } from '../packages/sdk/src/abis/keel-cross-chain-mint.generated.ts';
test('publication discovery and ABI ownership agree',()=>{
 const module=KEEL_MODULES.find(m=>m.id==='keel-publication');
 assert.deepEqual(module.deps,['keel-hold']);
 assert.deepEqual([...module.deployable].sort(),Object.keys(publication).sort());
 assert.deepEqual([...ABI_CONTRACTS['keel-publication']].sort(),Object.keys(publication).sort());
 assert.ok(publication.KeelPublicationJob.some(x=>x.type==='function'&&x.name==='openJob'));
});
test('bridge ABI remains separately available to explicit users',()=>{
 assert.deepEqual(Object.keys(bridge),['KeelCrossChainMintBridge']);
 assert.deepEqual(ABI_CONTRACTS['keel-cross-chain-mint'],['KeelCrossChainMintBridge']);
 assert.ok(bridge.KeelCrossChainMintBridge.some(x=>x.type==='function'&&x.name==='requestCrossMint'));
});
