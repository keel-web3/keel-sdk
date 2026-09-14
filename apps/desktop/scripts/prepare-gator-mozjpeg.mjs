/** Encode an optional JPEG variant and insert restart markers without re-quantizing. */
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const sharp=createRequire(new URL('../../../packages/studio-core/package.json',import.meta.url))('sharp');
sharp.concurrency(2);
const run=promisify(execFile),base='apps/desktop/artifacts/gator-raster-study/full-1080';
const quality=Number(process.env.KEEL_JPEG_QUALITY||75),root=`${base}/mozjpeg-q${quality}`;
await mkdir(root,{recursive:true});
const ids=JSON.parse(await readFile('apps/desktop/artifacts/gator-raster-study/sample-ids.json','utf8'));
for(let i=0;i<ids.length;i++) {
 const id=ids[i],input=await sharp(`${base}/native-128-sample/token-${id}.png`).removeAlpha().jpeg({mozjpeg:true,quality,chromaSubsampling:'4:2:0',progressive:false}).toBuffer();
 const source=`${root}/original-${id}.jpg`,target=`${root}/token-${id}.jpg`;
 await writeFile(source,input);
 await run('/opt/homebrew/bin/jpegtran',['-copy','none','-restart','2B','-outfile',target,source],{maxBuffer:1024*1024});
 const before=await sharp(input).raw().toBuffer(),after=await sharp(target).raw().toBuffer();
 assert.ok(before.equals(after),`Restart insertion changed decoded pixels for ${id}`);
 if((i+1)%32===0)console.log(JSON.stringify({phase:'mozjpeg',done:i+1,total:ids.length}));
}
await writeFile(`${root}/report.json`,JSON.stringify({quality,subsampling:'4:2:0',tokens:ids.length,size:1080,encoder:sharp.versions,restartIntervalMCUs:2,allRestartTranscodesPixelIdentical:true,sourcePNGPixelsExact:false},null,2));
