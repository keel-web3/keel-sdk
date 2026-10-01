# Module settings (`keel-module-inputs@1`)

A module, script or artwork can declare the settings people may change when
they use it: a color limited to a palette, a speed slider, a launch date, a
choice. Studio, the KEEL editor and agents show the same controls, check the
same rules, and hand the chosen values to the module before it runs.

Settings are data. A manifest names one of a fixed set of control types with
its bounds; it can never name or load UI code. The validator lives in
`@keel/protocol` (`normalizeModuleInputManifest`, `normalizeModuleInputValues`),
so every host accepts and rejects exactly the same things.

## Declare settings

Add `inputs` to `keel.module.json`, either as the field list or as the full
`{ "protocol": "keel-module-inputs@1", "fields": [...] }` object:

```json
{
  "schema": "keel.jsmodule@2",
  "id": "glow-field",
  "entry": "src/index.ts",
  "inputs": [
    { "key": "color", "label": "Glow color", "type": "color", "required": false,
      "swatches": ["#7c83ff", "#ff7a59"], "clamp": { "saturation": [35, 100], "lightness": [35, 75] },
      "default": "#7c83ff" },
    { "key": "rings", "label": "Rings", "type": "number", "required": false,
      "min": 1, "max": 24, "step": 1, "control": "slider", "default": 8 },
    { "key": "revealOn", "label": "Reveal on", "type": "date", "required": false,
      "placement": "advanced" }
  ]
}
```

`keel module build` and `keel module index` validate the settings and carry
them into the catalog entry. Studio's **Modules → Make a module** tab has a
settings designer that previews the controls and exports this JSON.

## Field types

Every field has `key` (a lowercase-first identifier), `label`, `required`, and
optional `help`, `placement` and `default`. A default must itself pass the rules.

| type | rules | value |
|---|---|---|
| `text` | `minLength`, `maxLength`, `multiline`, optional `placeholder` | string |
| `number` | `min`, `max`, `step`; optional `control: "slider" \| "field"`, `unit` | number on the step grid |
| `select` | `options: [{ value, label }]` (2–256) | one option value |
| `multi-select` | `options`, `minItems`, `maxItems` | unique option values |
| `color` | optional `swatches`, `allowCustom`, `clamp` | `#rrggbb` |
| `palette` | `minItems`, `maxItems`, optional `swatches`, `allowCustom`, `clamp` | unique `#rrggbb` list |
| `boolean` | — | `true` / `false` |
| `date` | optional `time`, `min`, `max` | `YYYY-MM-DD`, or UTC `YYYY-MM-DDTHH:MMZ` when `time` is true |

**Placement.** `"basic"` (the default) settings appear up front. `"advanced"`
settings sit behind a fold that opens on its own when one of them needs a fix.

**Colors.** `swatches` are one-tap suggestions. With `allowCustom: false` only
the swatches may be chosen. `clamp` limits custom colors by HSL range:
`hue: [from, to]` in degrees (a range whose start exceeds its end wraps through
0°, so `[330, 40]` allows reds), and `saturation` / `lightness` as `[min, max]`
percentages. Hue bounds ignore grays; raise the saturation minimum to exclude
them. Hosts dim the disallowed part of the color wheel and move picks to the
nearest allowed color (`clampColor`).

Limits: 1–24 fields, 96 KB per manifest, plain JSON only (no getters,
prototypes, symbols or reserved keys).

## Read settings at runtime

Hosts publish the chosen values, with defaults applied, before any included
module or creator script runs:

```js
const settings = globalThis.KEEL_INPUTS?.["glow-field"] ?? {};
```

`KEEL_INPUTS` is a deeply frozen map keyed by module id. Pass the object into
your module instead of reading globals inside it, so the module stays testable:

```ts
import { drawGlow, glowSettings } from "glow-field";
const look = glowSettings(KEEL_INPUTS["glow-field"]);
```

`createKeelInputsScript(entries)` in `@keel/protocol` produces the classic
script hosts inject. Values are serialized with script-safe escaping.

## Where the values live

- **Studio include flow** (`/modules/import`, and **Include modules and
  scripts** in a new project): the chosen values are checked on the server and
  baked into the included bundle, ahead of the module code, so they become part
  of the uploaded entry bytes.
- **Editor project download**: `keel-inputs.js` (injected first by
  `build.mjs`), `keel-inputs.json` (the chosen values) and `keel-inputs.d.ts`,
  which types `KEEL_INPUTS` field by field (swatch-only colors and options
  become literal unions).
- **KEEL editor**: settings for a saved module reference are stored on that
  reference, validated on every workspace save, and injected into both the live
  and canonical previews.
- **Studio uploads shared for reuse** keep their settings in the
  `keel.reusable-asset` declaration; the public project page offers the same form.
