// A large importing module graph verifies in the canonical shell.
//
// Regression: the shell once built a data URL for every resource up front,
// text-replacing every earlier resource id inside each later resource with
// that resource's full data URL. Game-engine modules name the ids they need in
// their wrappers, so each URL nested every earlier one and a 23-module game
// (the engine's level demo) failed with "Invalid string length". The same
// graph shape is built here: 32 modules, each naming every module before it,
// the last two importing through ES module specifiers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildKeelInlineLocalDocument, buildKeelInlineModuleFragment, buildKeelInlineShellFragments } from "../packages/sdk/dist/index.js";

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
    const child = spawn(binary, ["--headless", "--virtual-time-budget=4000", "--dump-dom", url], { stdio: ["ignore", "pipe", "pipe"] });
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

async function serve(bytes) {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(bytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

const MODULES = 32;
const ids = Array.from({ length: MODULES }, (_, index) => `engine/part-${String(index).padStart(2, "0")}`);
const encode = (text) => new TextEncoder().encode(text);

async function largeGraph() {
  const modules = [];
  for (let index = 0; index < MODULES - 2; index += 1) {
    // (Like an engine module's wrapper: the ids it needs, as data, plus some body.)
    const source = `(function(){var needs=${JSON.stringify(ids.slice(0, index))};var body=${JSON.stringify("x".repeat(2048))};(globalThis.__parts=globalThis.__parts||[]).push(${JSON.stringify(ids[index])});void needs;void body;})();\n`;
    modules.push(await buildKeelInlineModuleFragment({
      moduleId: ids[index], version: "1.0.0", mediaType: "text/javascript", decodedBytes: encode(source),
      compression: "gzip", execution: "classic", phase: "runtime", weight: index - MODULES,
    }));
  }
  const esmBase = ids[MODULES - 2];
  const esmTop = ids[MODULES - 1];
  modules.push(await buildKeelInlineModuleFragment({
    moduleId: esmBase, version: "1.0.0", mediaType: "text/javascript",
    decodedBytes: encode(`export const names=${JSON.stringify(ids.slice(0, MODULES - 2))};\nexport function count(){return globalThis.__parts.length;}\n`),
    compression: "gzip", execution: "module", phase: "runtime", weight: 0,
  }));
  modules.push(await buildKeelInlineModuleFragment({
    moduleId: esmTop, version: "1.0.0", mediaType: "text/javascript",
    decodedBytes: encode(`import {names,count} from "${esmBase}";\nexport const total=count()+names.length;\n`),
    compression: "gzip", execution: "module", phase: "runtime", weight: 1,
  }));
  return modules;
}

test("a 32-module graph whose modules name each other and import by specifier verifies and runs", { timeout: 60_000 }, async () => {
  const [chrome, shell, modules] = await Promise.all([headlessChrome(), buildKeelInlineShellFragments({ repositoryRoot: process.cwd() }), largeGraph()]);
  const expected = (MODULES - 2) * 2;
  // (The entry throws unless every classic module ran and the import chain resolved; a throw fails the shell.)
  const entry = `import {total} from "${ids[MODULES - 1]}";\nif(globalThis.__parts.length!==${MODULES - 2}||total!==${expected})throw new Error("large graph incomplete: "+globalThis.__parts.length+" "+total);\ndocument.body.dataset.parts=String(total);\n`;
  const local = await buildKeelInlineLocalDocument({ shell, modules, entry: { id: "large/entry", mediaType: "text/javascript", source: encode(entry), compression: "none" } });
  const fixture = await serve(local.rootBytes);
  try {
    const rendered = await dumpDOM(chrome, fixture.origin);
    assert.doesNotMatch(rendered.stdout, /Invalid string length/u);
    assert.match(rendered.stdout, /<body[^>]*data-verification="verified"/u);
    assert.match(rendered.stdout, /id="verify-title">KEEL verified/u);
    assert.match(rendered.stdout, /<iframe/u);
  } finally {
    await fixture.close();
  }
});

test("names in the entry document still resolve, nested through the text resources they name", { timeout: 60_000 }, async () => {
  const [chrome, shell, modules] = await Promise.all([headlessChrome(), buildKeelInlineShellFragments({ repositoryRoot: process.cwd() }), largeGraph()]);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#0f0"/></svg>';
  const css = "#art{width:2px;height:2px;background:url(dot.svg)}";
  // (The stylesheet names dot.svg; the entry names the stylesheet. The entry checks both resolved to verified data URLs.)
  const html = `<!doctype html><html><head><link rel="stylesheet" href="look.css"></head><body><div id="art"></div><script type="module">
const link=document.querySelector("link");
if(!link.href.startsWith("data:text/css;base64,"))throw new Error("stylesheet name did not resolve");
const text=atob(link.href.slice(link.href.indexOf(",")+1));
if(!text.includes("url(data:image/svg+xml;base64,"))throw new Error("nested image name did not resolve");
if(globalThis.__parts.length!==${MODULES - 2})throw new Error("modules missing");
</script></body></html>`;
  const local = await buildKeelInlineLocalDocument({
    shell, modules,
    entry: { id: "names.html", mediaType: "text/html", source: encode(html) },
    assets: [
      { id: "dot.svg", mediaType: "image/svg+xml", source: encode(svg) },
      { id: "look.css", mediaType: "text/css", source: encode(css) },
    ],
  });
  const fixture = await serve(local.rootBytes);
  try {
    const rendered = await dumpDOM(chrome, fixture.origin);
    assert.match(rendered.stdout, /<body[^>]*data-verification="verified"/u);
    assert.match(rendered.stdout, /id="verify-title">KEEL verified/u);
  } finally {
    await fixture.close();
  }
});
