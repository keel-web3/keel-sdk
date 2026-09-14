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
