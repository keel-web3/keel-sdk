import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assignTemporalWebPDelays} from '../packages/builder/dist/temporal-webp.js';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),sharp=require('sharp');
const rgba=Buffer.alloc(4*4*4*3);for(let i=0;i<48;i++){rgba[i*4+Math.floor(i/16)]=255;rgba[i*4+3]=255;}
const original=new Uint8Array(await sharp(rgba,{raw:{width:4,height:12,channels:4,pageHeight:4}}).webp({lossless:true,delay:[100,100,100],loop:0}).toBuffer());
const timeline={frameTimesMs:[0,120,360],frameDurationsMs:[120,240,200]};
test('standard WebP duration correction preserves the entire frame payload, loop and original bytes',async()=>{
  const before=original.slice(),output=assignTemporalWebPDelays(original,timeline),inputMeta=await sharp(original,{animated:true}).metadata(),meta=await sharp(output,{animated:true}).metadata();
  assert.deepEqual(original,before);assert.notEqual(output,original);assert.equal(output.length,original.length);
  assert.deepEqual(meta.delay,[120,240,200]);assert.equal(meta.loop,inputMeta.loop);assert.equal(meta.pages,inputMeta.pages);
  assert.deepEqual(await sharp(output,{animated:true}).ensureAlpha().raw().toBuffer(),await sharp(original,{animated:true}).ensureAlpha().raw().toBuffer());
  const changed=[];for(let i=0;i<output.length;i++)if(output[i]!==original[i])changed.push(i);
  assert.equal(changed.length,3);assert.ok(changed.every(offset=>output[offset-12]===0),'only the exact duration byte of each unchanged ANMF frame may differ');
});
test('unrepresentable, omitted, reordered and truncated timelines fail closed without mutating the container',()=>{
  for(const timeline of [{frameTimesMs:[0,120],frameDurationsMs:[120,240]},
    {frameTimesMs:[0,120,360],frameDurationsMs:[120,240,0]},
    {frameTimesMs:[0,120,360],frameDurationsMs:[120,240,200.1]},
    {frameTimesMs:[0,120,360],frameDurationsMs:[120,240,0x1000000]},
    {frameTimesMs:[0,121,360],frameDurationsMs:[120,240,200]},
    {frameTimesMs:[1,120,360],frameDurationsMs:[120,240,200]}])assert.throws(()=>assignTemporalWebPDelays(original,timeline),/exact|omitted|merged/);
  for(const delay of [1,10])assert.throws(()=>assignTemporalWebPDelays(original,{frameTimesMs:[0,delay,delay*2],frameDurationsMs:[delay,delay,delay]}),/clamp/);
  assert.equal(assignTemporalWebPDelays(original,{frameTimesMs:[0,11,22],frameDurationsMs:[11,11,11]}).length,original.length);
  for(const bytes of [new Uint8Array(),original.subarray(0,original.length-1),Uint8Array.from(original,(v,i)=>i===4?v+1:v)])assert.throws(()=>assignTemporalWebPDelays(bytes,timeline));
});
test('strict animation parser rejects duplicate headers, flags, bad frame bounds, reordered control and corrupt padded chunks',()=>{
  const retained=original.slice();
  const chunks=[];let p=12;
  while(p<original.length){const n=new DataView(original.buffer,original.byteOffset+p+4,4).getUint32(0,true);chunks.push({kind:Buffer.from(original.subarray(p,p+4)).toString('ascii'),p,n});p+=8+n+(n&1);}
  const frame=chunks.find(c=>c.kind==='ANMF'),anim=chunks.find(c=>c.kind==='ANIM'),header=chunks.find(c=>c.kind==='VP8X');
  const mutate=callback=>{const bytes=original.slice();callback(bytes,new DataView(bytes.buffer));return bytes};
  const duplicate=chunk=>{const part=original.subarray(chunk.p,chunk.p+8+chunk.n+(chunk.n&1));const output=Buffer.concat([original,part]);output.writeUInt32LE(output.length-8,4);return output};
  const cases=[duplicate(header),duplicate(anim),
    mutate(b=>{b[header.p+8]&=~2}),mutate(b=>{b[header.p+9]=1}),mutate(b=>{b[frame.p+23]=0x80}),
    mutate(b=>{b[frame.p+8]=255;b[frame.p+9]=255;b[frame.p+10]=255}),
    mutate((_b,v)=>v.setUint32(frame.p+4,0xffffffff,true)),mutate((_b,v)=>v.setUint32(frame.p+24+4,0xffffffff,true)),
    mutate(b=>{b[anim.p]=88}),mutate(b=>{b[frame.p+24]=88})];
  for(const bytes of cases)assert.throws(()=>assignTemporalWebPDelays(bytes,timeline));
  assert.deepEqual(original,retained,'negative parsing never mutates retained input');
});
