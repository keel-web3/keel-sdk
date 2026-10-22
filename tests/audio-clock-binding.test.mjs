import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {prepareMediaCandidate,verifyActualMediaPair} from '../packages/builder/dist/media-preparation.js';
const recipe={schema:'keel-media-edit@1',mode:'lossless',format:'mp4',quality:82,noSound:false},original={...recipe,mode:'original',format:'original'};
const source=new Uint8Array(await readFile(new URL('../docs/review/temporal-audio-binding-20261022/aac-original.mp4',import.meta.url)));
function rewrite(buffer,names,replace){const b=Buffer.from(buffer),parts=[];for(let p=0;p<b.length;){const n=b.readUInt32BE(p),kind=b.toString('latin1',p+4,p+8);assert.ok(n>=8&&p+n<=b.length);let box=Buffer.from(b.subarray(p,p+n));if(kind===names[0]){if(names.length===1)box=replace(box);else{const body=rewrite(box.subarray(8),names.slice(1),replace);box=Buffer.concat([box.subarray(0,8),body]);box.writeUInt32BE(box.length)}}parts.push(box);p+=n}return new Uint8Array(Buffer.concat(parts))}
let track=0,media=0,edits=0,timing=0;
let changed=rewrite(source,['moov','mvhd'],b=>{b.writeUInt32BE(601,24);return b});
changed=rewrite(changed,['moov','trak','tkhd'],b=>{if(track++===1)b.writeUInt32BE(601,28);return b});
changed=rewrite(changed,['moov','trak','mdia','mdhd'],b=>{if(media++===1)b.writeUInt32BE(b.readUInt32BE(24)+1,24);return b});
changed=rewrite(changed,['moov','trak','edts','elst'],b=>{if(edits++===1)b.writeUInt32BE(601,16);return b});
changed=rewrite(changed,['moov','trak','mdia','minf','stbl','stts'],b=>{if(timing++===1){assert.equal(b.readUInt32BE(12),2);assert.equal(b.readUInt32BE(28),128);b.writeUInt32BE(129,28)}return b});
assert.deepEqual(changed,new Uint8Array(await readFile(new URL('../docs/review/temporal-audio-binding-20261022/aac-one-tick-tail.mp4',import.meta.url))));
test('normal qualified AAC keeps full priming/padding PCM and exact presentation',async()=>{const proof=await verifyActualMediaPair({sourceBytes:source,candidateBytes:source,recipe});assert.equal(proof.source.audio.totalSamples,29696);assert.equal(proof.source.audio.frameTimes[0],0);assert.deepEqual(proof.source.audio,proof.candidate.audio)});
for(const side of ['source','candidate'])test(`AAC declared +1 final tick cannot hide in unchanged codec-tail PCM on ${side}`,async()=>{assert.deepEqual((await prepareMediaCandidate({bytes:changed,recipe:original})).bytes,changed);await assert.rejects(verifyActualMediaPair({sourceBytes:side==='source'?changed:source,candidateBytes:side==='candidate'?changed:source,recipe}),/audio|sample|duration|timeline|preserv/i)});

test('unsupported AAC frame-length config retains exact original instead of inferring 1024 samples',async()=>{
 const malformed=Uint8Array.from(source),at=Buffer.from(malformed).indexOf(Buffer.from([0x11,0x88,0x56,0xe5,0]));assert.ok(at>=0);malformed[at+1]|=4;
 assert.deepEqual((await prepareMediaCandidate({bytes:malformed,recipe:original})).bytes,malformed);
 for(const side of ['source','candidate'])await assert.rejects(verifyActualMediaPair({sourceBytes:side==='source'?malformed:source,candidateBytes:side==='candidate'?malformed:source,recipe}),/AAC|audio|frame|semantics|preserv/i);
});

test('audio-only f64 PCM remains byte-exact native; no fictitious video equivalence is issued',async()=>{
 const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),ffmpeg=require('ffmpeg-static'),dir=await mkdtemp(path.join(tmpdir(),'keel-audio-only-'));
 try{const file=path.join(dir,'source.wav');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.6','-c:a','pcm_f64le','-y',file]);const bytes=new Uint8Array(await readFile(file));assert.deepEqual((await prepareMediaCandidate({bytes,mediaType:'audio/wav',recipe:original})).bytes,bytes);await assert.rejects(verifyActualMediaPair({sourceBytes:bytes,candidateBytes:bytes,recipe:{...recipe,format:'mov'}}),/not a verified self-contained media container.*original bytes remain retainable/i)}finally{await rm(dir,{recursive:true,force:true})}
});
test('nonstandard AAC edit priming cannot borrow a valid padded decoder result',async()=>{
 let index=0;const bytes=rewrite(source,['moov','trak','edts','elst'],b=>{if(index++===1)b.writeUInt32BE(1,20);return b});
 assert.deepEqual((await prepareMediaCandidate({bytes,recipe:original})).bytes,bytes);await assert.rejects(verifyActualMediaPair({sourceBytes:bytes,candidateBytes:source,recipe}),/audio|AAC|priming|clock|edit|preserv/i);
});

test('unmodeled PCM speaker layout keeps native bytes and cannot borrow mono sample hashes',async()=>{
 const source=new Uint8Array(await readFile(new URL('../docs/review/temporal-audio-binding-20261022/pcm-original.mov',import.meta.url))),bytes=Uint8Array.from(source),at=Buffer.from(bytes).indexOf(Buffer.from('chan'));assert.ok(at>0);new DataView(bytes.buffer).setUint32(at+8,(102<<16)|2);
 assert.deepEqual((await prepareMediaCandidate({bytes,recipe:original})).bytes,bytes);await assert.rejects(verifyActualMediaPair({sourceBytes:bytes,candidateBytes:source,recipe:{...recipe,format:'mov'}}),/audio|channel|layout|semantics|preserv/i);
});
