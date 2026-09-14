import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

function dumpDOM(binary, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--headless", "--virtual-time-budget=2500", "--dump-dom", url], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Chrome failed (${code}): ${stderr}`)));
  });
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
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("the protected K shell mounts only verified art inside an opaque network-denied frame", { timeout: 30_000 }, async () => {
  const [chrome, fixture] = await Promise.all([headlessChrome(), fixtureServer()]);
  try {
    const valid = await dumpDOM(chrome, fixture.origin);
    assert.match(valid.stdout, /data-vault-verification="verified"/u);
    assert.match(valid.stdout, /id="verify-seal"/u);
    assert.match(valid.stdout, /id="verify-title">KEEL verified/u);
    assert.match(valid.stdout, /class="verify-page-nav"/u);
    assert.match(valid.stdout, /data-keel-panel-placement="right"/u);
    assert.match(valid.stdout, /sandbox="allow-scripts allow-pointer-lock"/u);
    assert.doesNotMatch(valid.stdout, /allow-same-origin|>PWNED<|https?:\/\//u);
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

test("the marketplace-safe prepared animation URI installs token context before the K shell launches", { timeout: 30_000 }, async () => {
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
  const graph = await buildKeelInlinePreEncodedTokenURIGraph(local, { legacyCarriage: "acknowledged" });
  const prepared = await buildKeelPreparedOneOfOneTokenURI({
    graph,
    chainId: 11_155_111,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "Context proof",
    description: "Pure Base64 browser proof",
    imageURI: "data:image/svg+xml;base64,PHN2Zy8+",
    manifestURI: `web3://0x${"cd".repeat(20)}:11155111/object/0x${"ef".repeat(32)}`,
    manifestDigest: `0x${"12".repeat(32)}`,
  });
  const metadata = JSON.parse(Buffer.from(prepared.tokenURI.split(",", 2)[1], "base64").toString("utf8"));
  const animationPayload = metadata.animation_url.split(",", 2)[1];
  assert.match(animationPayload, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
  assert.doesNotMatch(animationPayload, /[#?&_-]/u);

  const [chrome, fixture] = await Promise.all([headlessChrome(), new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(Buffer.from(animationPayload, "base64"));
    });
    server.listen(0, "127.0.0.1", () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
    }));
  })]);
  try {
    const rendered = await dumpDOM(chrome, fixture.origin);
    assert.match(rendered.stdout, /data-vault-verification="verified"/u);
    assert.match(rendered.stdout, /id="verify-seal"/u);
    assert.match(rendered.stdout, /id="verify-title">KEEL verified/u);
    assert.match(rendered.stdout, /0xabababababababababababababababababababab/u);
    assert.doesNotMatch(rendered.stderr, /Uncaught|net::ERR|Failed to load resource/iu);
  } finally {
    await fixture.close();
  }
});

test("the compact escaped animation URI is directly browser-readable without inner Base64 decoding", { timeout: 30_000 }, async () => {
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
  const graph = await buildKeelInlineEscapedTokenURIGraph(local, { legacyCarriage: "acknowledged" });
  const prepared = await buildKeelPreparedOneOfOneTokenURI({
    graph,
    chainId: 11_155_111,
    collection: `0x${"ab".repeat(20)}`,
    collectionName: "Escaped context proof",
    description: "Compact percent carriage browser proof",
    imageURI: "data:image/svg+xml;base64,PHN2Zy8+",
    manifestURI: `web3://0x${"cd".repeat(20)}:11155111/object/0x${"ef".repeat(32)}`,
    manifestDigest: `0x${"12".repeat(32)}`,
  });
  const metadata = JSON.parse(Buffer.from(prepared.tokenURI.split(",", 2)[1], "base64").toString("utf8"));
  assert.equal(prepared.animationEncoding, "percent");
  assert.equal(prepared.requiredBuilder, "KeelPercentTokenURIBuilder");
  assert.match(metadata.animation_url, /^data:text\/html;charset=utf-8,/u);
  assert.doesNotMatch(metadata.animation_url.slice(metadata.animation_url.indexOf(",") + 1), /[\s<>"'&#?\\]/u);
  assert.equal(new URL(metadata.animation_url).href, metadata.animation_url);
  assert.ok(decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(",") + 1)).startsWith(new TextDecoder().decode(local.rootBytes)));

  const chrome = await headlessChrome();
  const rendered = await dumpDOM(chrome, metadata.animation_url);
  assert.match(rendered.stdout, /data-vault-verification="verified"/u);
  assert.match(rendered.stdout, /id="verify-title">KEEL verified/u);
  assert.match(rendered.stdout, /0xabababababababababababababababababababab/u);
  assert.doesNotMatch(rendered.stderr, /Uncaught|net::ERR|Failed to load resource/iu);
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
  const originalPayload = `"storedBase64":"${Buffer.from(entry).toString("base64")}"`;
  const changedBytes = Buffer.from(new TextDecoder().decode(entry).replace("ORIGINAL", "MODIFIED"));
  assert.equal(changedBytes.byteLength, entry.byteLength, "same-length substitution must require a digest check");
  assert.equal(original.split(originalPayload).length, 2, "exactly one creator payload is replaced");
  const changed = original.replace(originalPayload, `"storedBase64":"${changedBytes.toString("base64")}"`);
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
