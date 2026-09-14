import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../../packages/builder/package.json',import.meta.url));const sharp=require('sharp');sharp.concurrency(2);
const exec=promisify(execFile);const root=new URL('../',import.meta.url);const {fileURLToPath}=await import('node:url');
const source=JSON.parse(await readFile(new URL('evidence/source.json',root)));
const selection=process.argv.includes('--first')?source.editions.slice(0,1):source.editions;
const paths=[];for(const e of selection)for(const variant of e.variation?['','_var']:['']){paths.push(`data/${e.id}${variant}/1600/${e.id}_000.webp`);}for(const id of [1,6,11])if(selection.some(e=>e.id===id))paths.push(`data/${id}/4600/${id}_000.jpg`);
const report={schema:'link2-lossless-comparison@1',pixelDefinition:'Sharp decoded sRGB RGBA8, exact every byte; retained originals remain authoritative, including metadata.',tools:{sharp:sharp.versions,avifenc:(await exec('avifenc',['--version'])).stdout.trim(),cwebp:(await exec('cwebp',['-version'])).stdout.trim()},samples:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const path of paths){const input=new URL('original/'+path,root);let original;try{original=await readFile(input)}catch{console.log('missing',path);continue}const dir=new URL('candidates/'+path+'/',root);await mkdir(dir,{recursive:true});
const decoded=await sharp(original).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const png=new URL('reference.png',dir);await sharp(decoded.data,{raw:decoded.info}).png().toFile(fileURLToPath(png));
const row={path,originalBytes:original.length,originalSha256:hash(original),width:decoded.info.width,height:decoded.info.height,rgbaSha256:hash(decoded.data),candidates:[]};
for(const format of ['webp','avif']){const output=new URL('lossless.'+format,dir);const start=Date.now();
try{if(format==='webp')await exec('cwebp',['-quiet','-lossless','-exact','-m','6',fileURLToPath(png),'-o',fileURLToPath(output)],{timeout:180000});else await exec('avifenc',['--lossless','--cicp','1/13/0','--range','full','--yuv','444','--depth','8','--jobs','2','--speed','6',fileURLToPath(png),fileURLToPath(output)],{timeout:180000});
const bytes=await readFile(output);const pixels=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});let changed=0,maxDelta=0;for(let i=0;i<decoded.data.length;i++){const d=Math.abs(decoded.data[i]-pixels.data[i]);if(d){changed++;maxDelta=Math.max(maxDelta,d)}}const exact=pixels.info.width===decoded.info.width&&pixels.info.height===decoded.info.height&&pixels.data.equals(decoded.data);
row.candidates.push({format,bytes:bytes.length,sha256:hash(bytes),rgbaSha256:hash(pixels.data),pixelIdentical:exact,changedChannels:changed,maxChannelDelta:maxDelta,smaller:bytes.length<original.length,eligible:exact&&bytes.length<original.length&&path.endsWith('.webp'),elapsedMs:Date.now()-start});
}catch(e){row.candidates.push({format,error:e.message,eligible:false})}}
row.selected='original';const eligible=row.candidates.filter(c=>c.eligible).sort((a,b)=>a.bytes-b.bytes);if(eligible.length)row.selected=eligible[0].format;report.samples.push(row);await writeFile(new URL('evidence/compression.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(row));}
