# Module imports, shared state, and editor types

Use normal JavaScript imports for a module API. The imported name is local to
that script and stays typed in any TypeScript-aware editor:

```ts
import thumbnail from "@keel-modules/thumbnail-capture";
thumbnail.snapshot();
```

`keel module build` emits an installable ESM package in the module's `dist`
directory. Its `package.json` connects the minified runtime to generated
TypeScript declarations. `keel-module-types.json` records the compiler version,
source digests, runtime recipe digest, output integrity, and declaration digest.
Origin verification regenerates these declarations from the pinned checkout.
If an external project cannot produce declarations, verification reports that
separately; reproducible JavaScript does not require TypeScript adoption.

## Shared state across your items

```ts
import { declareGlobals } from "@keel/sdk/module";
export const state = declareGlobals({ frame: 0 });
```

The creator compiler supplies the project-relative script path as its identity,
such as `items/stars/state.ts`. A normal import of `state` in another script
retains its inferred types. State remains mutable; the namespace binding cannot
be overwritten. A second declaration at the same name throws.

An explicit name is available when needed:

```ts
export const state = declareGlobals({ frame: 0 }, "stars");
```

`getGlobals("stars")` retrieves it from the current JavaScript realm. Arbitrary
string lookups return `unknown`; projects can augment `GlobalModules` to type
known names. Direct imports are preferable because their types follow the
actual source automatically. These globals do not cross iframe boundaries.

The compiler recognizes direct named imports of `declareGlobals` from
`@keel/sdk/module`, including aliases. Without the creator compiler, supply an
explicit name. The automatic path is independent of local absolute directories
and generated asset hashes. Ordinary module imports use the existing ESM
bundler and do not require an editor extension or manual `globalThis` access.

## Automatic inclusion and ordinary IDE support

Pass `modules: [{ name: "thumbnail", specifier: "@keel-modules/thumbnail-capture" }]`
to `buildCreatorProject`. The same inclusion record generates editor declarations
and esbuild imports. Author code can call `thumbnail.snapshot()` directly.
Default explicit globals are `KEEL_<module>_<export>`; an existing `KEEL_` export
keeps its declared name and also gets a short alias. Ambiguous aliases fail;
use the inclusion record's `aliases` map to resolve them.

The build refreshes `.keel/module-inclusions.d.ts` and `.keel/globals.d.ts`, then
type-checks the entries before emitting. Include `.keel/*.d.ts` in tsconfig.
`keel module editor --watch` keeps declarations current while editing a project
with `keel.includes.json`. Exported `declareGlobals` variables automatically
augment `GlobalModules`, using `typeof import` so their members retain live types.
Excluded modules lose their automatic bindings. Ordinary explicit imports remain
ordinary imports and do not require global inclusion.

`keel module install` reproduces a pinned Git origin and installs its matching
runtime and declaration files without running package scripts. Verification is
optional for authoring: `module observe` creates a browser discovery page;
`module infer` binds the saved observation to the uploaded source and prepares a
local ESM package. These commands never execute uploaded JavaScript in Node.

Discovery runs in an opaque `allow-scripts` iframe with networking disabled.
Classic discovery records synchronous newly created own globals, without calling
their functions or getters. The observation library also supports ESM exports.
It cannot infer unexecuted branches, lexical globals, later interaction-created
APIs, or every argument type. Source inference supplies signatures where possible;
unresolved values remain `unknown`. Observations and inferred declarations do
not confer verification. Discovery is optional for modules with an exported or
author-declared API.

See `examples/verified-module-editor/KEEL.code-workspace` for the tested project.
