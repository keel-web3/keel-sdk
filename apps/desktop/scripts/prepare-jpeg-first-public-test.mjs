/** Repack only token 0's referenced byte ranges. No JPEG re-encoding or flattening. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {keccak256} from 'viem';
const source='apps/desktop/artifacts/gator-raster-study/full-1080/jpeg-shared-huffman-q85-r2/substrings-24/overlap-packed/compact';
const root='apps/desktop/artifacts/gator-sepolia/jpeg-token0-package';
await mkdir(`${root}/data`,{recursive:true});await mkdir(`${root}/instructions`,{recursive:true});
const codec=await readFile(`${source}/codec.bin`),map=await readFile(`${source}/token-0.map`),catalog=await readFile(`${source}/instruction-ranges.bin`);
const operations=[],requests=new Map(),data=new Map(),iw=codec[5],pw=codec[4],ow=codec[6];
for(let i=0;i<map.length;i+=iw){const id=map.readUIntBE(i,iw),p=catalog.readUInt16BE(id*6),o=catalog.readUInt16BE(id*6+2),n=catalog.readUInt16BE(id*6+4),ops=(await readFile(`${source}/instructions/${p}.bin`)).subarray(o,o+n);for(let j=0;j<ops.length;j+=ow){const p=ops.readUIntBE(j,pw),o=ops.readUInt16BE(j+pw),n=ops.readUInt16BE(j+pw+2);operations.push([p,o,n]);if(!requests.has(p))requests.set(p,[]);requests.get(p).push([o,o+n]);}}
const intervals=new Map(),parts=[];let size=0;
for(const[p,ranges]of [...requests].sort((a,b)=>a[0]-b[0])){const bytes=await readFile(`${source}/data/${p}.bin`);data.set(p,bytes);const merged=[];for(const[start,end]of ranges.sort((a,b)=>a[0]-b[0])){if(merged.length&&start<=merged.at(-1)[1])merged.at(-1)[1]=Math.max(merged.at(-1)[1],end);else merged.push([start,end]);}const records=[];for(const[start,end]of merged){records.push([start,end,size]);parts.push(bytes.subarray(start,end));size+=end-start;}intervals.set(p,records);}
const pool=Buffer.concat(parts),copies=[];
for(const[p,o,n]of operations){const interval=intervals.get(p).find(([a,b])=>o>=a&&o+n<=b);assert.ok(interval);let at=interval[2]+o-interval[0],left=n;while(left){const page=Math.floor(at/23000),offset=at%23000,length=Math.min(left,23000-offset);const prev=copies.at(-1);if(prev&&prev[0]===page&&prev[1]+prev[2]===offset)prev[2]+=length;else copies.push([page,offset,length]);left-=length;at+=length;}}
const groups=[],lookup=new Map(),tokenMap=[];
for(let i=0;i<copies.length;i+=16){const ops=copies.slice(i,i+16),b=Buffer.alloc(ops.length*ow);ops.forEach(([p,o,n],j)=>{b.writeUIntBE(p,j*ow,pw);b.writeUInt16BE(o,j*ow+pw);b.writeUInt16BE(n,j*ow+pw+2);});const key=b.toString('hex');if(!lookup.has(key)){lookup.set(key,groups.length);groups.push(b);}tokenMap.push(lookup.get(key));}
const instruction=Buffer.concat(groups),ranges=Buffer.alloc(groups.length*6);assert.ok(instruction.length<23000);let at=0;groups.forEach((b,i)=>{ranges.writeUInt16BE(at,i*6+2);ranges.writeUInt16BE(b.length,i*6+4);at+=b.length;});
const packedMap=Buffer.alloc(tokenMap.length*iw);tokenMap.forEach((id,i)=>packedMap.writeUIntBE(id,i*iw,iw));
const pages=[];for(let i=0;i<pool.length;i+=23000){const b=pool.subarray(i,i+23000);pages.push(b);await writeFile(`${root}/data/${pages.length-1}.bin`,b);}
const rebuilt=Buffer.concat(copies.map(([p,o,n])=>pages[p].subarray(o,o+n))),expected=await readFile(`${source}/preview-0.jpg`);assert.deepEqual(rebuilt,expected);
for(const[file,b]of [['instructions/0.bin',instruction],['instruction-ranges.bin',ranges],['token-0.map',packedMap],['codec.bin',codec],['preview-0.jpg',rebuilt]])await writeFile(`${root}/${file}`,b);
const allowance=(pages.length+1)*20+6;await writeFile(`${root}/address-and-root-placeholders.bin`,Buffer.alloc(allowance));
const report={quality:85,size:1080,tokens:1,tokenIds:[0],preparedBinaryBytes:pool.length+instruction.length+ranges.length+packedMap.length+codec.length+allowance,imageBytes:rebuilt.length,dataBytes:pool.length,instructionBytes:instruction.length,rangeBytes:ranges.length,mapBytes:packedMap.length,codec:codec.toString('hex'),imageDigest:keccak256(rebuilt),exactJPEGBytes:true,scope:'First public test only; same KJC1 codec with selected source intervals repacked. Not a full-collection storage measurement. Original 128-token library retained.',source};await writeFile(`${root}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
