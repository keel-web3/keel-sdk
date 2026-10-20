import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dumpBrowserDom} from './helpers/browser-dom-navigation.mjs';

for(const virtualTimeBudgetMs of [2500,5000]) {
  test(`CDP navigates an exact oversized UTF8 data URI with the original ${virtualTimeBudgetMs}ms virtual budget`,{timeout:30_000},async()=>{
    const binary=process.env.KEEL_CHROME_HEADLESS_SHELL;
    assert.ok(binary,'An actual explicitly selected Chrome is required');
    const html=`<!doctype html><html><body><p>原本🙂</p><!--${'source bytes '.repeat(20_000)}--><script>document.body.dataset.origin=location.origin;setTimeout(()=>document.body.dataset.early='yes',${virtualTimeBudgetMs-500});setTimeout(()=>document.body.dataset.late='no',${virtualTimeBudgetMs+500});</script></body></html>`;
    const uri='data:text/html;charset=utf-8,'+encodeURIComponent(html);
    assert.ok(Buffer.byteLength(uri,'utf8')>131_072,'Exercise the Linux single-argument ceiling without reducing content');
    if(process.platform==='linux') {
      const original=spawnSync(binary,['--headless',`--virtual-time-budget=${virtualTimeBudgetMs}`,'--dump-dom',uri]);
      assert.equal(original.error?.code,'E2BIG','The same exact URI must reproduce the original kernel argv failure');
    }
    const result=await dumpBrowserDom(binary,uri,{virtualTimeBudgetMs,fixtureMode:'dom-dump'});
    assert.deepEqual(result.navigation.requested,{sha256:createHash('sha256').update(uri,'utf8').digest('hex'),utf8Bytes:Buffer.byteLength(uri,'utf8')});
    assert.deepEqual(result.navigation.observed,result.navigation.requested);
    assert.equal(result.navigation.argvDocument,'about:blank');
    assert.equal(result.navigation.virtualTimeBudgetMs,virtualTimeBudgetMs);
    assert.match(result.stdout,/data-origin="null"/u);
    assert.match(result.stdout,/data-early="yes"/u);
    assert.doesNotMatch(result.stdout,/data-late="no"/u);
    assert.match(result.stdout,/原本🙂/u);
    assert.deepEqual(result.stderr,'');
  });
}
