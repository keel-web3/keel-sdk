import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  KEEL_MODULE_INPUTS_PROTOCOL,
  clampColor,
  colorWithinClamp,
  createKeelInputsScript,
  hexToHsl,
  hslToHex,
  hueWithin,
  moduleInputDefaults,
  moduleInputPlacement,
  normalizeModuleInputManifest,
  normalizeModuleInputValues,
} from "../packages/protocol/dist/index.js";

const manifest = {
  protocol: KEEL_MODULE_INPUTS_PROTOCOL,
  fields: [
    { key: "title", label: "Title", type: "text", minLength: 2, maxLength: 12, multiline: false, required: true },
    { key: "speed", label: "Speed", type: "number", min: 0.1, max: 2, step: 0.1, control: "slider", unit: "x", required: false, default: 0.3 },
    { key: "mood", label: "Mood", type: "select", options: [{ value: "calm", label: "Calm" }, { value: "loud", label: "Loud" }], required: true },
    { key: "warm", label: "Warm accent", type: "color", clamp: { hue: [330, 40], saturation: [40, 100] }, required: false, default: "#e0402a" },
    { key: "brand", label: "Brand color", type: "color", swatches: ["#4553e6", "#ffffff"], allowCustom: false, required: true, placement: "basic" },
    { key: "palette", label: "Palette", type: "palette", minItems: 1, maxItems: 3, swatches: ["#111111", "#eeeeee"], required: false, placement: "advanced" },
    { key: "opens", label: "Opens", type: "date", min: "2026-01-01", max: "2026-12-31", required: false, placement: "advanced" },
    { key: "at", label: "Reveal time", type: "date", time: true, required: false, placement: "advanced" },
    { key: "glow", label: "Glow", type: "boolean", required: false, default: true },
  ],
};

test("module settings manifests accept every control, placement and rule", () => {
  const normalized = normalizeModuleInputManifest(manifest);
  assert.deepEqual(normalized, manifest);
  assert.deepEqual(normalized.fields.map(moduleInputPlacement), ["basic", "basic", "basic", "basic", "basic", "advanced", "advanced", "advanced", "basic"]);
  assert.deepEqual(moduleInputDefaults(normalized), { speed: 0.3, warm: "#e0402a", glow: true });
});

test("values honor clamps, swatches, date bounds and apply defaults in order", () => {
  const values = normalizeModuleInputValues(manifest, { title: "Hi", mood: "calm", brand: "#4553E6", opens: "2026-06-30", at: "2026-10-01T14:30Z", palette: ["#111111", "#abcdef"] });
  assert.deepEqual(values, { title: "Hi", speed: 0.3, mood: "calm", warm: "#e0402a", brand: "#4553e6", palette: ["#111111", "#abcdef"], opens: "2026-06-30", at: "2026-10-01T14:30Z", glow: true });
  const base = { title: "Hi", mood: "calm", brand: "#4553e6" };
  for (const bad of [
    { ...base, brand: "#123456" },
    { ...base, warm: "#2a60e0" },
    { ...base, warm: "#808080" },
    { ...base, opens: "2025-12-31" },
    { ...base, opens: "2026-02-30" },
    { ...base, opens: "2026-06-30T10:00Z" },
    { ...base, at: "2026-10-01T24:00Z" },
    { ...base, at: "2026-10-01" },
    { ...base, speed: 2.05 },
    { ...base, palette: ["#111111", "#111111"] },
    { ...base, extra: 1 },
  ]) assert.throws(() => normalizeModuleInputValues(manifest, bad), undefined, JSON.stringify(bad));
});

test("manifests reject malformed rules", () => {
  const color = manifest.fields[3];
  const date = manifest.fields[6];
  for (const bad of [
    { ...manifest, fields: [{ ...color, placement: "hidden" }] },
    { ...manifest, fields: [{ ...color, clamp: {} }] },
    { ...manifest, fields: [{ ...color, clamp: { saturation: [80, 20] } }] },
    { ...manifest, fields: [{ ...color, clamp: { hue: [0, 400] } }] },
    { ...manifest, fields: [{ ...color, swatches: ["#2a60e0"] }] },
    { ...manifest, fields: [{ ...color, allowCustom: false, default: undefined }] },
    { ...manifest, fields: [{ ...date, min: "2027-01-01" }] },
    { ...manifest, fields: [{ ...date, min: "01/02/2026" }] },
    { ...manifest, fields: [{ ...manifest.fields[1], control: "knob" }] },
    { ...manifest, fields: [{ ...manifest.fields[1], onChange: "alert(1)" }] },
    { ...manifest, fields: [{ ...manifest.fields[1], key: "constructor" }] },
    { ...manifest, renderer: "x" },
    JSON.parse('{"protocol":"keel-module-inputs@1","fields":[],"__proto__":{"polluted":true}}'),
  ]) assert.throws(() => normalizeModuleInputManifest(JSON.parse(JSON.stringify(bad))), undefined, JSON.stringify(bad));
});

test("color helpers round-trip and clamp to the nearest allowed color", () => {
  for (const hex of ["#4553e6", "#ff0000", "#00ff7f", "#123456", "#ffffff", "#000000"]) {
    const { h, s, l } = hexToHsl(hex);
    assert.equal(hslToHex(h, s, l), hex);
  }
  assert.equal(hueWithin(10, [330, 30]), true);
  assert.equal(hueWithin(200, [330, 30]), false);
  assert.equal(hueWithin(200, [0, 360]), true);
  const clamp = { hue: [330, 40], saturation: [40, 100], lightness: [30, 70] };
  for (const hex of ["#2a60e0", "#808080", "#ffffff", "#000000", "#00ff00"]) {
    const clamped = clampColor(hex, clamp);
    assert.equal(colorWithinClamp(clamped, clamp), true, `${hex} → ${clamped}`);
  }
});

test("the inputs script publishes deeply frozen values before modules run", () => {
  const values = normalizeModuleInputValues(manifest, { title: "</script><b>", mood: "loud", brand: "#ffffff", palette: ["#111111"] });
  const script = createKeelInputsScript([{ moduleId: "glow-field", values }]);
  assert.equal(script.includes("</script>"), false);
  const context = vm.createContext({});
  vm.runInContext(script, context);
  vm.runInContext(createKeelInputsScript([{ moduleId: "other", values: { a: 1 } }]), context);
  const inputs = vm.runInContext("globalThis.KEEL_INPUTS", context);
  assert.equal(inputs["glow-field"].title, "</script><b>");
  assert.deepEqual([...inputs["glow-field"].palette], ["#111111"]);
  assert.equal(inputs.other.a, 1);
  assert.equal(vm.runInContext("Object.isFrozen(KEEL_INPUTS['glow-field'].palette) && Object.isFrozen(KEEL_INPUTS)", context), true);
  assert.throws(() => createKeelInputsScript([{ moduleId: "__proto__", values: {} }]));
  assert.throws(() => createKeelInputsScript([{ moduleId: "a", values: {} }, { moduleId: "a", values: {} }]));
});
