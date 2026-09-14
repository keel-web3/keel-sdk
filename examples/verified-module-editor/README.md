# Open this project in VS Code

Open `KEEL.code-workspace`, then `src/art.ts`. This prepared workspace uses VS Code's TypeScript language service; no KEEL extension is required.

- `thumbnail.snapshot()` has the verified module's signature.
- `solarDates()` and `KEEL_solarDates()` have inferred arguments and return types from an unverified uploaded JavaScript fixture.
- `getGlobals("src/state.ts")` resolves the exported shared state and its live source types.
- Default explicit globals use `KEEL_<module>_<export>`, such as `KEEL_thumbnail_thumbnail`. Existing explicit `KEEL_` names are preserved.

`solar.js` is an API fixture returning an empty array, not an eclipse dataset. Its observation was captured in an opaque browser iframe; it is not a verification receipt.

From this directory, after building the SDK repository, run `npm run setup`, `npm run check`, `npm run build`, then `npm run preview`. Setup reproduces the pinned public thumbnail source and installs its declarations. It also prepares the unverified fixture from its source and saved observation. Open the preview URL to exercise both modules and the capture button.

To keep changes to the inclusion list and global declarations current while editing, run `npm run editor`. Removing a module from `keel.includes.json` removes its generated editor bindings. Build regenerates and checks the same list before emitting the artwork. Include `.keel/*.d.ts` in a consuming project's TypeScript configuration.

For a new upload, `keel module observe --file script.js --out discovery.html` creates the isolated discovery page. Open it and save the observation, then run `keel module infer --file script.js --observation keel-observation.json --name my-module --out node_modules/my-module` into a new package directory. Add that package to the inclusion list. Verification is optional. Source inference supplies types it can establish; unresolved types remain `unknown`.

Discovery covers synchronous own globals of classic scripts, and the library observation API also supports ESM export discovery. It does not discover lexical `let`/`const` bindings or globals created only after a later interaction. Those need an exported API or supplied declarations. Never treat runtime observation as source verification.

This example proves local compilation and browser execution. It does not deploy contracts, publish modules onchain, or update hosted Studio.
