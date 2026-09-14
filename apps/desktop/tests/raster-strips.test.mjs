import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compilePNGStrips,assemblePNGStrips,verifyStripPNG,compileLayerStripStack,pngStripEnvelope} from '@keel/sdk/raster-strips';
import {assembleLayerAPNG} from '@keel/sdk/raster-apng';

test('independent compressed strips reassemble to a standard PNG with exact RGBA',async()=>{
  const width=17,height=37,data=Uint8Array.from({length:width*height*4},(_,i)=>(i*19+(i>>>7))%256),image={width,height,data};
  for(const rows of [1,8,16,256]){const {recipe,chunks}=compilePNGStrips(image,rows),png=await assemblePNGStrips(recipe,async id=>chunks.get(id).bytes);assert.equal(verifyStripPNG(png,image).exactRGBA,true);assert.equal(png.includes(Buffer.from('acTL')),false);
    await assert.rejects(()=>assemblePNGStrips(recipe,async id=>{const b=chunks.get(id).bytes.slice();b[10]^=1;return b;}),/integrity/);
    assert.throws(()=>pngStripEnvelope({...recipe,height:height+1}),/heights/);
  }
});
test('overlap cache reuses actual pixels and culls fully hidden layers',async()=>{
  const width=4,height=8,cache=new Map(),a=new Uint8Array(width*height*4).fill(255),b=a.slice();b[3]=128;let blends=0;
  const run=()=>compileLayerStripStack(width,height,2,async(i,y,rows)=>(i?b:a).slice(y*width*4,(y+rows)*width*4),{stripRows:4,cache,composite:async layers=>{blends++;return layers[0];}});
  const first=await run(),second=await run();assert.equal(blends,1);assert.equal(first.stats.overlapping,1);assert.equal(first.stats.hiddenLayersSkipped,1);assert.equal(second.stats.cacheHits,2);
  b[0]=0;await run();assert.equal(blends,2,'changed source invalidates the overlap cache');
});
test('APNG reuses compressed raster layers with OVER, no disposal, and one play',async()=>{
  const image={width:4,height:4,data:new Uint8Array(64).fill(255)},one=compilePNGStrips(image),png=await assemblePNGStrips(one.recipe,async id=>one.chunks.get(id).bytes),apng=assembleLayerAPNG([png,png]);
  const chunks=[];for(let p=8;p<apng.length;){const n=apng.readUInt32BE(p);chunks.push({type:apng.toString('ascii',p+4,p+8),data:apng.subarray(p+8,p+8+n)});p+=n+12;}
  assert.equal(chunks.find(c=>c.type==='acTL').data.readUInt32BE(4),1);const controls=chunks.filter(c=>c.type==='fcTL');assert.equal(controls.length,2);assert.equal(controls[1].data[24],0);assert.equal(controls[1].data[25],1);
  const idat=chunks.filter(c=>c.type==='IDAT').map(c=>c.data),fdat=chunks.filter(c=>c.type==='fdAT').map(c=>c.data.subarray(4));assert.deepEqual(Buffer.concat(idat),Buffer.concat(fdat));
  assert.throws(()=>assembleLayerAPNG([apng]),/Animated source/);
});
