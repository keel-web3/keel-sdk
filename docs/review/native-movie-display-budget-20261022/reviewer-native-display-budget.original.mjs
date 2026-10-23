import assert from 'node:assert/strict';
import test from 'node:test';
import cp from 'node:child_process';
import {promisify} from 'node:util';
import {syncBuiltinESMExports,createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('./packages/builder/package.json',import.meta.url)),ffmpeg=require('ffmpeg-static');
const r=new URL('../evidence/',import.meta.url);await mkdir(r,{recursive:true});const file=new URL('native-overbudget-display.mp4',r);
// Tiny coded raster; actual qualified display is8192x1024 for300 frames.
cp.execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:size=32x1024:rate=5','-frames:v','300','-vf','format=gbrp,setsar=256/1','-c:v','libx264rgb','-crf','0','-color_primaries','1','-color_trc','13','-colorspace','0','-color_range','pc','-threads','2','-an','-y',file.pathname]);
const bytes=new Uint8Array(await readFile(file)),real=promisify(cp.execFile),launches=[];let heavy=false;
// Forward every actual probe/tool call. Refuse only the over-budget full scaled
// framehash launch, so this negative cannot consume2.5billion displayed pixels.
const wrapper=(...args)=>cp.execFile(...args);
wrapper[promisify.custom]=async(binary,args,options)=>{launches.push(args);if(args.includes('framehash')&&args.includes('-vf')){heavy=true;throw new Error('REVIEWER_BLOCKED_OVERBUDGET_SCALED_DECODE');}return real(binary,args,options);};
cp.execFile=wrapper;syncBuiltinESMExports();
const {compareMediaFrames,ORIGINAL_MEDIA_EDIT_RECIPE}=await import('./packages/builder/dist/media-preparation.js');
test('qualified native display must reject total displayed-pixel budget before launching the scaled full decode',async t=>{
 t.diagnostic(JSON.stringify({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),coded:{width:32,height:1024,frames:300,pixels:32*1024*300},displayed:{width:8192,height:1024,frames:300,pixels:8192*1024*300},limit:2000000000}));
 try{await assert.rejects(compareMediaFrames({bytes,recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:0}),/bounded.*(?:decode|frame).*budget|display.*budget/i);assert.equal(heavy,false,'no over-budget scaled decode may start');}
 finally{await writeFile(new URL('native-display-budget-launches.json',r),JSON.stringify({heavy,launches},null,2)+'\n');}
});
