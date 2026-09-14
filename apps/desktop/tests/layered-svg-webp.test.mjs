import test from 'node:test';
import assert from 'node:assert/strict';
import {newLayeredArt,defaultPlacement,layerDigest,selectLayeredArt} from '@keel/sdk/layered-art';
import {renderLayeredSVG} from '@keel/sdk/layered-svg';
const webp=Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAEAcQ/Y8CBiKi/wEA','base64');
// A real 4x4 AVIF with an alpha auxiliary image, encoded by libavif.
const avif=Buffer.from('AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUEAAAGGbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAG8AAAAHwACAAAAAQAAAa4AAAAOAAAAQmlpbmYAAAAAAAIAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAABppbmZlAgAAAAACAABhdjAxQWxwaGEAAAAAGmlyZWYAAAAAAAAADmF1eGwAAgABAAEAAADDaXBycAAAAJ1pcGNvAAAAFGlzcGUAAAAAAAAABAAAAAQAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBIAAAAAAAE2NvbHJuY2x4AAEADQAGgAAAAA5waXhpAAAAAAEIAAAADGF2MUOBABwAAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAeaXBtYQAAAAAAAAACAAEEAQKDBAACBAEFhgcAAAA1bWRhdBIACgUYBH2FQDIDEAAMEgAKCDgEfYQENBpAMhEQAAAAD/pANwkx2UifOcbj5A==','base64');
async function fixture(bytes=webp){const objectId=await layerDigest(bytes),art={...newLayeredArt(),attributes:[{id:'art',name:'Art',items:[{id:'item',name:'Item',weight:1,variants:[{id:'v',name:'Original',objectId,weight:1}],placements:[defaultPlacement('bottom',0),defaultPlacement('top',5)],rules:[],usage:{scope:'renderer',renderer:'test',license:'',tags:[]}}]}]};return {art,selection:await selectLayeredArt(art,'seed','0')};}
test('still WebP layers embed once and are reused without active SVG content',async()=>{
 const {art,selection}=await fixture(),result=await renderLayeredSVG(art,selection,async()=>({bytes:webp,type:'image/webp'}));
 assert.equal(result.sourceBytes,webp.length);assert.equal(result.source.match(/data:image\/webp;base64,/g).length,1);assert.equal(result.source.match(/<use /g).length,2);assert.doesNotMatch(result.source,/<script|foreignObject|https:\/\//);
});
test('SVG exporter rejects tampering, mislabeled content, truncated WebP and animation',async()=>{
 const {art,selection}=await fixture();await assert.rejects(renderLayeredSVG(art,selection,async()=>({bytes:new Uint8Array([1]),type:'image/webp'})),/digest/);
 await assert.rejects(renderLayeredSVG(art,selection,async()=>({bytes:webp,type:'image/svg+xml'})),/PNG or still WebP/);
 for(const bad of [webp.subarray(0,webp.length-1),Buffer.from(webp)]){if(bad.length===webp.length)bad.write('ANIM',12);const f=await fixture(bad);await assert.rejects(renderLayeredSVG(f.art,f.selection,async()=>({bytes:bad,type:'image/webp'})),/container length|still WebP/);}
});
test('still AVIF layers embed once and mixed WebP/AVIF compositions share raster definitions',async()=>{
 const {art,selection}=await fixture(avif);
 const result=await renderLayeredSVG(art,selection,async()=>({bytes:avif,type:'image/avif'}));
 assert.equal(result.sourceBytes,avif.length);assert.equal(result.source.match(/data:image\/avif;base64,/g).length,1);
 const second=structuredClone(art.attributes[0]);second.id='webp';second.items[0].variants[0].objectId=await layerDigest(webp);art.attributes.push(second);
 const mixed=await renderLayeredSVG(art,await selectLayeredArt(art,'seed','0'),async id=>id===await layerDigest(avif)?{bytes:avif,type:'image/avif'}:{bytes:webp,type:'image/webp'});
 assert.equal(mixed.sourceBytes,avif.length+webp.length);assert.equal(mixed.source.match(/<image /g).length,2);assert.equal(mixed.source.match(/<use /g).length,4);
});
test('SVG AVIF validation rejects sequences, broken box lengths and mislabeled content',async()=>{
 const animated=Buffer.from(avif);animated.write('avis',8);
 const overflow=Buffer.from(avif);overflow.writeUInt32BE(0x7fffffff,32);
 const bogus=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
 for(const bytes of [animated,overflow,avif.subarray(0,avif.length-1),bogus]){
  const {art,selection}=await fixture(bytes);
  await assert.rejects(renderLayeredSVG(art,selection,async()=>({bytes,type:'image/avif'})),/AVIF/);
 }
});
