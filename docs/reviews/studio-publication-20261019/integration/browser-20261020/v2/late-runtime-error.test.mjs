import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {observeMarketplaceCsp} from './marketplace-csp-browser.mjs';
const binary='/Users/ravonus/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
test('observer retains a real runtime error after readiness but within its claimed unchanged4000ms observation window',{timeout:20000},async()=>{
 const html='<!doctype html><html><body><output id="result">waiting</output><script>setTimeout(()=>{document.querySelector("#result").dataset.state="passed";document.querySelector("#result").textContent="module ran"},50);setTimeout(()=>{throw new Error("REVIEW_LATE_RUNTIME_FAILURE")},250)</script></body></html>';
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html)});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const started=Date.now();const observed=await observeMarketplaceCsp(binary,`http://127.0.0.1:${server.address().port}`,'review-proof');console.log(JSON.stringify({elapsedMs:Date.now()-started,state:observed.state,events:observed.events}));assert.equal(observed.state.state,'passed');assert.ok(observed.events.some(e=>e.kind==='exception'&&e.text.includes('REVIEW_LATE_RUNTIME_FAILURE')),'the actual post-readiness error within250ms must remain observable');}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('control captures the same real250ms exception while readiness is deliberately later',{timeout:20000},async()=>{
 const html='<!doctype html><html><body><output id="result">waiting</output><script>setTimeout(()=>{document.querySelector("#result").dataset.state="passed";document.querySelector("#result").textContent="module ran"},500);setTimeout(()=>{throw new Error("REVIEW_LATE_RUNTIME_FAILURE")},250)</script></body></html>';
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html)});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const observed=await observeMarketplaceCsp(binary,`http://127.0.0.1:${server.address().port}`,'review-proof');console.log(JSON.stringify({control:true,state:observed.state,events:observed.events}));assert.equal(observed.state.state,'passed');assert.ok(observed.events.some(e=>e.kind==='exception'&&e.text.includes('REVIEW_LATE_RUNTIME_FAILURE')));}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
