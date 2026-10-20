import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildKeelInlineAssetDisplayModuleFragment,
  buildKeelInlineLocalDocument,
  buildKeelInlineModuleFragment,
  buildKeelInlineShellFragments,
} from "../packages/sdk/dist/inline-viewer-graph.js";
import {KEEL_CREATIVE_RUNTIME_CATALOG} from "../packages/sdk/dist/creative-runtime-catalog.js";
import {createHash} from "node:crypto";
import {observeMarketplaceCsp} from "./helpers/marketplace-csp-browser.mjs";
function assertPinnedResource(id, bytes) {
  const resource=KEEL_CREATIVE_RUNTIME_CATALOG.flatMap(entry=>entry.resources).find(entry=>entry.id===id);
  assert.ok(resource?.integrity);
  assert.equal(bytes.byteLength,resource.integrity.byteLength);
  assert.equal('0x'+createHash('sha256').update(bytes).digest('hex'),resource.integrity.digest);
}
function assertMarketplaceExecution(rendered) {
  // Fonts are deliberately denied by the unchanged marketplace policy. Keep
  // their exact violations visible; every other policy/runtime error fails.
  const failures=rendered.events.filter(event=>event.kind==='exception'||event.kind==='instrumentation'||event.kind==='security'&&!/^Loading the font 'data:font\/woff2;base64,[A-Za-z0-9+/=.]+' violates the following Content Security Policy directive: "default-src 'none'"\. Note that 'font-src' was not explicitly set, so 'default-src' is used as a fallback\. The action has been blocked\.$/u.test(event.text));
  assert.deepEqual(failures,[]);
  assert.equal(rendered.frames.filter(frame=>frame.origin==='null').length,2);
}

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

async function renderUnderMarketplaceCsp(rootBytes, protocol) {
  const animationBase64 = Buffer.from(rootBytes).toString("base64");
  const host = `<!doctype html><html><body><output id="result">waiting</output><iframe id="marketplace" sandbox="allow-scripts"></iframe><script>
    addEventListener("message",event=>{const result=document.querySelector("#result");if(event.data?.protocol===${JSON.stringify(protocol)}){result.textContent=event.data.state==="ran"?"module ran":JSON.stringify(event.data);result.dataset.state=event.data.state==="ran"?"passed":"failed"}else if((event.data?.protocol==="keel-inline-runtime@1"||event.data?.protocol==="keel-inline-child@1")&&event.data?.action==="failed"){result.textContent=event.data.detail;result.dataset.state="failed"}});
    document.querySelector("#marketplace").srcdoc=atob(${JSON.stringify(animationBase64)});
  </script></body></html>`;
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self' 'unsafe-inline'; frame-src 'self' data:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'",
    );
    response.end(host);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const chrome = await headlessChrome();
    return await observeMarketplaceCsp(chrome, `http://127.0.0.1:${server.address().port}`, protocol);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("the canonical Inline shell runs verified data modules under a restrictive marketplace srcdoc CSP", { timeout: 30_000 }, async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const module = await buildKeelInlineModuleFragment({
    moduleId: "keel.csp-proof",
    version: "1.0.0",
    mediaType: "text/javascript",
    aliases: ["keel-csp-proof.js"],
    decodedBytes: new TextEncoder().encode('top.postMessage({protocol:"keel-csp-proof",state:"ran"},"*")'),
    compression: "gzip",
    execution: "classic",
  });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [module],
    entry: {
      id: "index.html",
      mediaType: "text/html",
      source: new TextEncoder().encode('<!doctype html><html><head><script src="keel-csp-proof.js"></script></head><body>art</body></html>'),
    },
  });
  const rendered = await renderUnderMarketplaceCsp(local.rootBytes, "keel-csp-proof");
  assertMarketplaceExecution(rendered);
  assert.match(rendered.stdout, /id="result" data-state="passed">module ran/u);
});

test("the canonical asset module starts only after its verified child mount exists", { timeout: 30_000 }, async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const assetDisplay = await buildKeelInlineAssetDisplayModuleFragment();
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [assetDisplay],
    entry: {
      id: "pixel.png",
      mediaType: "image/png",
      source: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    },
  });
  const rendered = await renderUnderMarketplaceCsp(local.rootBytes, "keel-asset-csp-proof");
  assert.doesNotMatch(rendered.stderr, /Cannot read properties of null|Uncaught/iu);
  assertMarketplaceExecution(rendered);
  assert.deepEqual(rendered.frames.find(frame=>frame.image!==null)?.image,{complete:true,width:1,height:1});
});

test("the exact p5 and seeded-random modules run under the marketplace CSP", { timeout: 30_000 }, async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const [p5Bytes, seededBytes] = await Promise.all([
    readFile("examples/demos/vendor/p5.min.js"),
    readFile("examples/library/seeded-random.js"),
  ]);
  assertPinnedResource("p5-1-11-3",p5Bytes);
  const p5 = await buildKeelInlineModuleFragment({
    moduleId: "p5-1-11-3",
    version: "1.11.3",
    mediaType: "text/javascript",
    aliases: ["p5.min.js", "./p5.min.js", "p5.js"],
    decodedBytes: p5Bytes,
    compression: "gzip",
    execution: "classic",
  });
  const seeded = await buildKeelInlineModuleFragment({
    moduleId: "keel.seeded-random",
    version: "1.0.0",
    mediaType: "text/javascript",
    aliases: ["seeded-random.js", "./seeded-random.js", "/content/seeded-random.js", "keel.seeded-random"],
    decodedBytes: seededBytes,
    compression: "gzip",
    execution: "module",
  });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [p5, seeded],
    entry: {
      id: "sketch.js",
      mediaType: "text/javascript",
      source: new TextEncoder().encode(`import { createSeededRandom } from "/content/seeded-random.js";
        const random=createSeededRandom("0x1234");
        top.postMessage({protocol:"keel-p5-csp-proof",state:typeof p5==="function"&&random()>=0?"ran":"failed"},"*");`),
    },
  });
  const rendered = await renderUnderMarketplaceCsp(local.rootBytes, "keel-p5-csp-proof");
  assertMarketplaceExecution(rendered);
  assert.match(rendered.stdout, /id="result" data-state="passed">module ran/u);
});

test("the exact Three.js r180 module pair runs under the marketplace CSP", { timeout: 30_000 }, async () => {
  const shell = await buildKeelInlineShellFragments({ repositoryRoot: process.cwd() });
  const [mainBytes, coreBytes] = await Promise.all([
    readFile("examples/demos/vendor/three.min.js"),
    readFile("examples/demos/vendor/three.core.min.js"),
  ]);
  const normalizedMain=new TextEncoder().encode(mainBytes.toString('utf8').replaceAll('from"/content/three.core.min.js"','from"./three.core.min.js"'));
  assertPinnedResource("three-r180-core",coreBytes);
  assertPinnedResource("three-r180-module",normalizedMain);
  const core = await buildKeelInlineModuleFragment({
    moduleId: "three-r180-core",
    version: "0.180.0",
    mediaType: "text/javascript",
    aliases: ["three.core.min.js", "./three.core.min.js", "/content/three.core.min.js"],
    decodedBytes: coreBytes,
    compression: "gzip",
    execution: "module",
  });
  const main = await buildKeelInlineModuleFragment({
    moduleId: "three-r180-module",
    version: "0.180.0",
    mediaType: "text/javascript",
    aliases: ["three.module.min.js", "./three.module.min.js", "/content/three.module.min.js"],
    decodedBytes: normalizedMain,
    compression: "gzip",
    execution: "module",
  });
  const local = await buildKeelInlineLocalDocument({
    shell,
    modules: [core, main],
    entry: {
      id: "scene.mjs",
      mediaType: "text/javascript",
      source: new TextEncoder().encode(`import * as THREE from "/content/three.module.min.js";
        const vector=new THREE.Vector3(1,2,3);top.postMessage({protocol:"keel-three-csp-proof",state:vector.length()>0?"ran":"failed"},"*");`),
    },
  });
  const rendered = await renderUnderMarketplaceCsp(local.rootBytes, "keel-three-csp-proof");
  assertMarketplaceExecution(rendered);
  assert.match(rendered.stdout, /id="result" data-state="passed">module ran/u);
});
