import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encodeThumbnailAvif} from '../packages/builder/dist/thumbnail-sequence.js';
import {resolveBundledFfmpeg} from '../packages/builder/dist/media-optimization.js';

test('motion preview preserves two distinct frames in a real AVIF sequence',async t=>{
  const encoder=await resolveBundledFfmpeg();
  if(!encoder.available){t.skip(encoder.reason);return;}
  const frames=[new Uint8Array(16),new Uint8Array(16)];
  for(let p=0;p<16;p+=4){frames[0][p]=255;frames[0][p+3]=255;frames[1][p+2]=255;frames[1][p+3]=255;}
  const avif=await encodeThumbnailAvif({width:2,height:2,frameRate:2,frames});
  const dir=await mkdtemp(path.join(tmpdir(),'keel-avif-test-'));
  try{
    const file=path.join(dir,'preview.avif');await writeFile(file,avif);
    // Reviewed platform builds expose either one timed sequence or a separate
    // primary still followed by that sequence. Verify the actual stream layout.
    const {spawnSync}=await import('node:child_process');
    const streamProbe=spawnSync(encoder.binary,['-hide_banner','-i',file,'-t','0','-map','0:v:0','-f','null','-'],{encoding:'utf8'});
    assert.equal(streamProbe.status,0,streamProbe.stderr);
    const streams=streamProbe.stderr.split('Output #')[0].split('\n').filter(line=>/^\s*Stream #.*Video:/u.test(line));
    assert.ok(streams.length===1||streams.length===2,`Unexpected AVIF video streams: ${streams.length}`);
    if(streams.length===2){
      const primary=execFileSync(encoder.binary,['-v','error','-i',file,'-map','0:v:0','-f','rawvideo','-pix_fmt','rgba','pipe:1']);
      assert.equal(primary.length,16);assert.ok(primary[0]>200&&primary[2]<40);
    }
    const decoded=execFileSync(encoder.binary,['-v','error','-i',file,'-map',streams.length===2?'0:v:1':'0:v:0','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgba','pipe:1']);
    assert.equal(decoded.length,32);assert.ok(decoded[0]>200&&decoded[2]<40);assert.ok(decoded[16]<40&&decoded[18]>200);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('motion preview rejects partial frames before encoding',async()=>{
 await assert.rejects(encodeThumbnailAvif({width:2,height:2,frameRate:12,frames:[new Uint8Array(1),new Uint8Array(16)]}),/complete RGBA/);
});
