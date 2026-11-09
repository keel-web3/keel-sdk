// Optional real-Chrome smoke, separate from the portable unit test suite.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {fixture} from './mock-recursion.mjs';
import {inscriptionId} from '../src/shell/index.mjs';
const {chromium}=createRequire(new URL('../../trailer/package.json',import.meta.url))('playwright');
const bundle=await build({entryPoints:[new URL('../src/shell/index.mjs',import.meta.url).pathname],bundle:true,platform:'browser',format:'iife',globalName:'KOC1Shell',write:false});
const f=fixture(),path='/content/'+inscriptionId(f.self);
f.mock.assets.set(path,'<!doctype html><script src="/shell.js"></script>');
f.mock.assets.set('/shell.js',bundle.outputFiles[0].text);
await f.mock.start();
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage(),requests=[];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==f.mock.base || !(url.pathname.startsWith('/r/') || url.pathname===path || url.pathname==='/shell.js'))return route.abort();
    requests.push(url.pathname);return route.continue();
  });
  await page.goto(f.mock.base+path);
  assert.deepEqual(await page.evaluate(()=>[typeof Buffer,typeof process,typeof require]),['undefined','undefined','undefined']);
  const verdict=await page.evaluate(()=>KOC1Shell.verifyShell({checkWork:false}));
  assert.equal(verdict.status,'member',verdict.reasons.join('; '));assert.equal(verdict.rank,1);
  assert.ok(requests.slice(2).every(path=>path.startsWith('/r/')));
  console.log(JSON.stringify({browser:await browser.version(),status:verdict.status,rank:verdict.rank,recursionFetches:verdict.stats.fetches,nonRecursionRuntimeRequests:0},null,2));
}finally{await browser.close();await f.mock.close();}
