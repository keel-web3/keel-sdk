import test from 'node:test';
import assert from 'node:assert/strict';
import {assertGatorInlineMetadata} from '../scripts/gator-inline-metadata.mjs';

test('Gator release accepts embedded SVG plus HTML and rejects the obsolete JPEG route',()=>{
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/webp;base64,dGVzdA=="/></svg>');
  const html=Buffer.from('<!doctype html><p>prepared viewer fixture</p>');
  const original={name:'TokenGator #0',attributes:[{trait_type:'Skin',value:'Lava'}],image:'ipfs://original'};
  const metadata={...original,image:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),animation_url:'data:text/html;charset=utf-8,'+encodeURIComponent(html)};
  const check=value=>assertGatorInlineMetadata(Buffer.from(JSON.stringify(value)),{svg,html,original,layerCount:1});
  assert.equal(check(metadata).proof.mediaPointers,0);
  assert.equal(check({...metadata,image:metadata.image.replace(';charset=utf-8','')}).proof.mediaPointers,0);
  assert.throws(()=>check({...metadata,image:'web3://0xaa909691b9f59b41a5fc3564d04a17261c36cec1:11155111/image/0.jpg'}),/inline layered SVG/);
  assert.throws(()=>check({...metadata,image:'data:image/jpeg;base64,dGVzdA=='}),/inline layered SVG/);
  assert.throws(()=>check({...metadata,animation_url:undefined,animate_url:metadata.animation_url}),/animation_url/);
  assert.throws(()=>check({...metadata,animation_url:'web3://example/viewer'}),/animation_url/);
  assert.throws(()=>check({metadata}),/inline layered SVG/);
  assert.throws(()=>check(JSON.stringify(metadata)),/one metadata object/);
  assert.throws(()=>check({...metadata,attributes:[]}),/Original contract-selected/);
});
