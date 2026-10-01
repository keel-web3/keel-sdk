import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { parseKeelModuleManifest } from "../packages/builder/dist/index.js";
import { createKeelEditorProject } from "../packages/builder/dist/module-project.js";
import { bundleKeelEditorModules } from "../packages/builder/dist/module-project-bundle.js";
import { createKeelInputsDeclarations } from "../packages/builder/dist/module-inputs-types.js";
import { KEEL_MODULE_INPUTS_PROTOCOL } from "../packages/protocol/dist/index.js";

const fields = [
  { key: "accent", label: "Accent", type: "color", swatches: ["#4553e6", "#ff704d"], allowCustom: false, required: true },
  { key: "rings", label: "Rings", type: "number", min: 1, max: 12, step: 1, control: "slider", required: false, default: 4 },
  { key: "opens", label: "Opens */ on", type: "date", required: false, placement: "advanced" },
];
const manifest = { protocol: KEEL_MODULE_INPUTS_PROTOCOL, fields };

test("keel.module.json accepts settings as a field list or a full manifest", () => {
  const base = { schema: "keel.jsmodule@2", id: "glow-field", version: "0.1.0", entry: "src/index.ts", license: "MIT", summary: "Glow.", category: "render", owner: { user: "ada" } };
  assert.deepEqual(parseKeelModuleManifest({ ...base, inputs: fields }).inputs, manifest);
  assert.deepEqual(parseKeelModuleManifest({ ...base, inputs: manifest }).inputs, manifest);
  assert.equal(parseKeelModuleManifest(base).inputs, undefined);
  assert.throws(() => parseKeelModuleManifest({ ...base, inputs: [{ ...fields[1], min: 20 }] }), /keel\.module\.json: inputs:/);
});

test("declarations type each module's settings and keep comments closed", () => {
  const source = createKeelInputsDeclarations([{ id: "glow-field", manifest }]);
  assert.match(source, /readonly "glow-field": \{/);
  assert.match(source, /readonly "accent": "#4553e6" \| "#ff704d";/);
  assert.match(source, /readonly "rings": number;/);
  assert.match(source, /readonly "opens"\?: string;/);
  assert.equal(source.includes("Opens */"), false);
  assert.match(source, /const KEEL_INPUTS: Readonly<KeelInputs>;/);
});

const runtime = 'const seen = globalThis.KEEL_INPUTS?.["glow-field"]; export function glow() { return seen; }';
const files = { "index.js": runtime, "index.d.ts": "export declare function glow(): unknown;" };

test("editor projects validate settings and publish them before modules evaluate", async () => {
  assert.throws(() => createKeelEditorProject([{ name: "glowField", files, settings: { id: "glow-field", manifest, values: { accent: "#000000" } } }]), /Accent/);
  const project = createKeelEditorProject([{ name: "glowField", files, settings: { id: "glow-field", manifest, values: { accent: "#FF704D" } } }]);
  assert.deepEqual(project.settings[0].values, { accent: "#ff704d", rings: 4 });
  assert.ok(project.files["keel-inputs.js"]);
  assert.match(project.files["build.mjs"], /inject:\["\.\/keel-inputs\.js","\.\/keel-bindings\.js"\]/);
  assert.ok(JSON.parse(project.files["tsconfig.json"]).include.includes("keel-inputs.d.ts"));

  const bundle = await bundleKeelEditorModules(project);
  const context = vm.createContext({});
  vm.runInContext(bundle, context);
  assert.deepEqual({ ...vm.runInContext("KEEL_glowField_glow()", context) }, { accent: "#ff704d", rings: 4 });

  // The exported project's own build must also run settings first.
  const directory = await mkdtemp(path.join(os.tmpdir(), "keel-inputs-"));
  try {
    for (const [name, contents] of Object.entries(project.files)) {
      const file = path.join(directory, name);
      await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(file), { recursive: true }));
      await writeFile(file, contents);
    }
    await writeFile(path.join(directory, "src/main.ts"), "globalThis.result = glow();");
    await build({ absWorkingDir: directory, entryPoints: ["src/main.ts"], bundle: true, format: "iife", platform: "browser", target: "es2022", inject: ["./keel-inputs.js", "./keel-bindings.js"], outfile: "dist/artwork.js", logLevel: "silent" });
    const output = await readFile(path.join(directory, "dist/artwork.js"), "utf8");
    const exported = vm.createContext({});
    vm.runInContext(output, exported);
    assert.deepEqual({ ...vm.runInContext("result", exported) }, { accent: "#ff704d", rings: 4 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("projects without settings are unchanged", () => {
  const project = createKeelEditorProject([{ name: "glowField", files }]);
  assert.equal(project.files["keel-inputs.js"], undefined);
  assert.match(project.files["build.mjs"], /inject:\["\.\/keel-bindings\.js"\]/);
  assert.deepEqual(project.settings, []);
});
