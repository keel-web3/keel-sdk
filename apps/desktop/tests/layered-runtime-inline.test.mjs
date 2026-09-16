import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {newLayeredArt,defaultPlacement,selectLayeredArt,canonicalLayerJSON} from '@keel/sdk/layered-art';

test('packaged inline runtime preserves SHA-256 and seeded choices without WebCrypto',async()=>{
  const source=await readFile(new URL('../../../packages/sdk/dist/layered-runtime.js',import.meta.url),'utf8');
  const context={TextEncoder,Uint8Array}; // A data-URI frame has no usable crypto.subtle.
  runInNewContext(source,context);
  const runtime=context.KEEL_LAYERS;
  for(const length of [0,1,55,56,63,64,65,127,128,129,1024,24000]){
    const bytes=Uint8Array.from({length},(_,i)=>(i*71+19)%256);
    assert.equal(await runtime.layerDigest(bytes),createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(await runtime.layerDigest('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const art={...newLayeredArt(),attributes:[{id:'skin',name:'Skin',items:['lava','paper'].map((id,i)=>({id,name:id,weight:i+1,variants:[{id:'original',name:'Original',objectId:'a'.repeat(64),weight:1}],placements:[defaultPlacement()],rules:[],usage:{scope:'renderer',renderer:'test',license:'',tags:[]}}))}]};
  for(const token of ['0','1','3999'])assert.equal(canonicalLayerJSON(await runtime.selectLayeredArt(art,'original',token)),canonicalLayerJSON(await selectLayeredArt(art,'original',token)));
});
