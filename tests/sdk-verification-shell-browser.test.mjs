import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildKeelInlineEscapedTokenURIGraph,
  buildKeelInlinePreEncodedTokenURIGraph,
  buildKeelInlineLocalDocument,
  buildKeelPreparedOneOfOneTokenURI,
  buildKeelInlineShellFragments,
} from "../packages/sdk/dist/index.js";
import {observeOfflineShell} from "./support/offline-shell-browser.mjs";
import {dumpBrowserDom} from "./helpers/browser-dom-navigation.mjs";

async function headlessChrome() {
  if (process.env.KEEL_CHROME_HEADLESS_SHELL) return process.env.KEEL_CHROME_HEADLESS_SHELL;
  const entries = await readdir(join(homedir(), "Library/Caches/ms-playwright"), { withFileTypes: true });
  const candidate = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("chromium_headless_shell-"))
    .sort((left, right) => right.name.localeCompare(left.name))
    .map((entry) => join(homedir(), "Library/Caches/ms-playwright", entry.name, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"))[0];
  if (candidate === undefined || !(await stat(candidate)).isFile()) throw new Error("Chrome headless shell missing");
  return candidate;
}

async function dumpDOM(binary,url) {
  return await dumpBrowserDom(binary,url,{virtualTimeBudgetMs:2500,fixtureMode:'dom-dump'});
}

async function fixtureServer() {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const entry = new TextEncoder().encode(`<!doctype html><html><head></head><body><div id="art">art</div><script>
    try { parent.document.querySelector('#verify-seal').textContent = 'PWNED' } catch {}
  </script></body></html>`);
  const valid = await buildKeelInlineLocalDocument({
    shell,
    modules: [],
    entry: { id: "art.html", mediaType: "text/html", source: entry },
  });
  const validHTML = new TextDecoder().decode(valid.rootBytes);
  const invalidHTML = validHTML.replace(/"digest":"0x[0-9a-f]{64}"/u, `"digest":"0x${"00".repeat(32)}"`);
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(request.url === "/invalid" ? invalidHTML : valid.rootBytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    validHTML,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("the protected K shell mounts only verified art inside an opaque network-denied frame", { timeout: 30_000 }, async () => {
  const [chrome, fixture] = await Promise.all([headlessChrome(), fixtureServer()]);
  try {
    const valid = await dumpDOM(chrome, fixture.origin);
    assert.match(valid.stdout, /data-vault-verification="verified"/u);
    assert.match(valid.stdout, /id="verify-seal"/u);
    assert.match(valid.stdout, /id="verify-title">Files verified/u);
    assert.match(valid.stdout, /class="verify-page-nav"/u);
    assert.match(valid.stdout, /data-keel-panel-placement="right"/u);
    assert.match(valid.stdout, /sandbox="allow-scripts allow-pointer-lock allow-downloads"/u);
    assert.doesNotMatch(valid.stdout, /allow-same-origin|>PWNED</u);
    const offline = await observeOfflineShell(fixture.validHTML, 'verified');
    assert.deepEqual(offline.externalRequests, []);
    assert.deepEqual(offline.pageNetworkRequests, []);
    assert.deepEqual(offline.errors, []);
    assert.equal(offline.opaque, true);
    assert.equal(offline.frames, 1);
    assert.doesNotMatch(valid.stderr, /Uncaught|net::ERR|Failed to load resource/iu);

    const invalid = await dumpDOM(chrome, `${fixture.origin}/invalid`);
    assert.match(invalid.stdout, /data-vault-verification="failed"/u);
    assert.match(invalid.stdout, /id="verify-seal"/u);
    assert.match(invalid.stdout, /id="verify-title">Verification failed/u);
    assert.doesNotMatch(invalid.stdout, /<iframe/u);
  } finally {
    await fixture.close();
  }
});

test("retired pre-encoded publication carriage rejects before marketplace context can be prepared", { timeout: 30_000 }, async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [],
    entry: {
      id: "context.html",
      mediaType: "text/html",
      source: new TextEncoder().encode('<!doctype html><html><body><div id="art">context ready</div></body></html>'),
    },
  });
  await assert.rejects(() => buildKeelInlinePreEncodedTokenURIGraph(local, { legacyCarriage: "acknowledged" }), error => error.name === "KeelLegacyCarriageError" && /^buildKeelInlinePreEncodedTokenURIGraph is retired for publication\./u.test(error.message));
});

test("retired escaped publication carriage rejects instead of preparing a historical animation URI", { timeout: 30_000 }, async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [],
    entry: {
      id: "escaped-context.html",
      mediaType: "text/html",
      source: new TextEncoder().encode('<!doctype html><html><body><div id="art">escaped context ready</div></body></html>'),
    },
  });
  await assert.rejects(() => buildKeelInlineEscapedTokenURIGraph(local, { legacyCarriage: "acknowledged" }), error => error.name === "KeelLegacyCarriageError" && /^buildKeelInlineEscapedTokenURIGraph is retired for publication\./u.test(error.message));
});

test("the unchanged canonical shell rejects changed artwork bytes and accepts the original again", { timeout: 30_000 }, async () => {
  const [chrome, shell] = await Promise.all([
    headlessChrome(),
    buildKeelInlineShellFragments({ repositoryRoot: process.cwd() }),
  ]);
  const entry = new TextEncoder().encode('<!doctype html><html><head></head><body><div id="art">ORIGINAL</div></body></html>');
  const local = await buildKeelInlineLocalDocument({
    shell, modules: [],
    entry: { id: "response.html", mediaType: "text/html", compression: "none", source: entry },
  });
  const original = new TextDecoder().decode(local.rootBytes);
  const escapedString = value => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  const originalPayload = `"storedText":${escapedString(new TextDecoder().decode(entry))}`;
  const changedBytes = Buffer.from(new TextDecoder().decode(entry).replace("ORIGINAL", "MODIFIED"));
  assert.equal(changedBytes.byteLength, entry.byteLength, "same-length substitution must require a digest check");
  assert.equal(original.split(originalPayload).length, 2, "exactly one creator payload is replaced");
  const changed = original.replace(originalPayload, `"storedText":${escapedString(changedBytes.toString("utf8"))}`);
  assert.deepEqual([...changed.matchAll(/"digest":"0x[0-9a-f]{64}"/gu)].map(match => match[0]),
    [...original.matchAll(/"digest":"0x[0-9a-f]{64}"/gu)].map(match => match[0]),
    "all original digest commitments stay intact");
  let responseBytes = original;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(responseBytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/same-object`;
  try {
    const valid = await dumpDOM(chrome, url);
    assert.match(valid.stdout, /data-vault-verification="verified"/u);
    assert.match(valid.stdout, /id="verify-seal"/u);
    assert.match(valid.stdout, /<iframe/u);
    responseBytes = changed;
    const invalid = await dumpDOM(chrome, url);
    assert.match(invalid.stdout, /data-vault-verification="failed"/u);
    assert.match(invalid.stdout, /Verification failed/u);
    assert.doesNotMatch(invalid.stdout, /<iframe/u, "changed content never receives an executable frame");
    responseBytes = original;
    const restored = await dumpDOM(chrome, url);
    assert.match(restored.stdout, /data-vault-verification="verified"/u);
    assert.match(restored.stdout, /<iframe/u);
    assert.ok(requests >= 3, "the same URL was fetched again for each browser load");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("canonical chrome displays logical token identity and supply without an audit claim", { timeout: 30_000 }, async () => {
  const {encodeKeelReleasePolicy,describeKeelReleasePolicy}=await import('../packages/protocol/dist/index.js');
  const source=await readFile(new URL('../packages/viewer/src/keel-verification-chrome.js',import.meta.url),'utf8');
  const word=encodeKeelReleasePolicy({mode:'adjustable',limit:10n,ceiling:20n})|5n;
  const context={chainId:31337,tokenId:'54',releaseDisclosure:{source:'pinned-rpc',releaseId:'2',localId:'5',rows:describeKeelReleasePolicy(word),policyWord:word.toString(),targetMaximum:'100',authority:'0x1111111111111111111111111111111111111111',router:'0x2222222222222222222222222222222222222222',blockNumber:'123',blockHash:'0x'+'cd'.repeat(32)}};
  const fixture='<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><script type="module">'+source+'\nmountKeelVerification({result:{state:"unavailable",isFixture:true,title:"Supply fixture",summary:"Local display test",proofTier:"Local fixture",checks:[]},runtime:{},context:'+JSON.stringify(context)+'});</script></body></html>';
  const server=createServer((_request,response)=>{response.setHeader('content-type','text/html; charset=utf-8');response.end(fixture);});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const result=await dumpDOM(await headlessChrome(),`http://127.0.0.1:${server.address().port}`);
    for(const text of ['Logical release','Token within release','Adjustable maximum','Permanent maximum','Supply snapshot block','Supply is reported at this pinned block'])assert.ok(result.stdout.includes(text),text);
    assert.match(result.stdout,/data-vault-verification="unavailable"/u);
    assert.doesNotMatch(result.stderr,/Uncaught|net::ERR|Failed to load resource/iu);
  } finally {await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
