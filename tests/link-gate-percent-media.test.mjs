import assert from 'node:assert/strict';
import test from 'node:test';
import { scanKeelLinkGate } from '../packages/sdk/dist/link-gate.js';
const utf8 = value => new TextEncoder().encode(value);
const scan = value => scanKeelLinkGate({route:'test-percent-media',resources:[{id:'media',bytes:utf8(value)}]});
function wav() {
  const bytes=Buffer.alloc(600000); bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  for(let n=0;n<(bytes.length-44)/2;n++) bytes.writeInt16LE(Math.round(Math.sin(n*440*2*Math.PI/16000)*8000),44+n*2);
  return bytes;
}
const html = `<audio src="data:audio/wav;base64,${wav().toString('base64')}"></audio>`;
for(const depth of [1,2]) test(`percent depth ${depth} scans the complete WAV instead of thousands of Base64 fragments`,()=>{
  let encoded=html; for(let n=0;n<depth;n++) encoded=encodeURIComponent(encoded);
  assert.ok([...encoded.matchAll(/[A-Za-z0-9+\/_-]{32,}={0,2}/gu)].length>4096);
  const report=scan(encoded);assert.equal(report.status,'clear');assert.deepEqual(report.coverage.uninspected,[]);
});
test('encoded media coverage never exempts locators inside decoded payload or adjoining runs',()=>{
  const hidden=Buffer.from('https://evil.example/hidden-resource').toString('base64');
  for(const value of [
    encodeURIComponent(encodeURIComponent(`<audio src="data:audio/wav;base64,${hidden}"></audio>`)),
    `${encodeURIComponent(encodeURIComponent(html))} ${hidden}`,
    encodeURIComponent(`${html} ${hidden}`),
    `${encodeURIComponent(html)} https://evil.example/literal`,
    encodeURIComponent(`data:audio/wav;tag=${hidden};base64,${wav().toString('base64')}`),
  ]) { const report=scan(value);assert.equal(report.status,'blocked');assert.ok(report.hits.some(hit=>hit.url.startsWith('https://evil.example/'))); }
});
test('independent Base64 run budget remains 4096 even alongside inspected media',()=>{
  const runs=Array(4096).fill('A'.repeat(32)).join(' ');
  assert.equal(scan(`${runs} ${encodeURIComponent(html)}`).status,'clear');
  const report=scan(`${encodeURIComponent(html)} ${runs} ${'A'.repeat(32)}`);
  assert.equal(report.status,'blocked');assert.ok(report.coverage.uninspected.some(reason=>reason.includes('4096 Base64 runs')));
});
test('malformed and over-depth encoded data cannot obtain successful inspection coverage',()=>{
  let deep=html;for(let n=0;n<8;n++) deep=encodeURIComponent(deep);
  const report=scan(deep);assert.equal(report.status,'blocked');assert.ok(report.coverage.uninspected.length>0);
  const bad=scan(encodeURIComponent(`data:audio/wav;base64,${'A'.repeat(40)}! https://evil.example/tail`));
  assert.equal(bad.status,'blocked');assert.ok(bad.hits.some(hit=>hit.url.includes('evil.example')));
});
