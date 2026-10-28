import test from "node:test";
import assert from "node:assert/strict";
import { assertKeelVerifiedModuleSyntax } from "../packages/sdk/dist/creator-prepared-inline.js";
import { prepareKeelCreatorInline } from "../packages/sdk/dist/index.js";

test("modules the registered loader can rewrite pass", () => {
  for (const source of [
    'import{a as b}from"keel://module/lit.js";export{b as c};',
    'import * as lit from "./lit.js"\nexport function draw(){return lit}',
    'const x=1;import"./side.js";export const y=x;',
    'var q=()=>{};export{q as default,q};',
    'function f(){}export{f}',
    'export{a}from"./a.js";',
  ]) assertKeelVerifiedModuleSyntax(source, "ok.js");
});

test("an import right after a closing brace is refused before anything is prepared", () => {
  // The exact shape esbuild emitted for keel/tiles; the shell showed "Verification failed" after minting.
  const tiles = 'function k(){return 1}import{Attribute as ae}from"keel://module/lit.js";export{k as blobIndex};';
  assert.throws(() => assertKeelVerifiedModuleSyntax(tiles, "tiles.js"), error => error.code === "KEEL_VERIFIED_MODULE_SYNTAX" && /tiles\.js/u.test(error.message) && /\}import\{Attribute/u.test(error.message));
  assert.throws(() => assertKeelVerifiedModuleSyntax('x=1;export default 3', "d.js"), { code: "KEEL_VERIFIED_MODULE_SYNTAX" });
  // The same module with the import on its own line passes.
  assertKeelVerifiedModuleSyntax(tiles.replace("}import", "}\nimport"), "tiles.js");
});

test("prepareKeelCreatorInline refuses a module the registered loader would reject", async () => {
  const poster = { mediaType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=", "base64") };
  const resources = [
    { id: "index.html", role: "entrypoint", mediaType: "text/html", bytes: Buffer.from("<script type=module src=./a.js></script>") },
    { id: "lit.js", role: "module", mediaType: "text/javascript", bytes: Buffer.from("export const L=1;") },
    { id: "a.js", role: "module", mediaType: "text/javascript", aliases: ["./a.js"], bytes: Buffer.from('function k(){}import{L}from"./lit.js";export{k};') },
  ];
  await assert.rejects(prepareKeelCreatorInline({ chainId: 11155111, store: "0xD820e337692A6Eb7a4878e42ce88CBCFF49B55CF", resources, poster }), { code: "KEEL_VERIFIED_MODULE_SYNTAX" });
});
