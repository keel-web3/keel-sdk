# Canonical verification shell: OnKEEL theme and application API

The canonical shell uses the existing OnKEEL logo, charcoal surfaces, indigo controls, cyan success color and locally embedded Keel Display/Text fonts. It uses the same protected proof engine: files are checked before the sandboxed artwork executes. Desktop proof docks beside the work; narrow previews use one bottom sheet. Explicit presentation manifests remain supported.

Proof shows a plain explanation and check totals. Files lists checked resources and expandable/copyable fingerprints. Token lists chain identity, supplied metadata and attributes. System lists code modules, manifests, plugin declarations, external sources, versions and storage objects. Missing declarations stay explicit. Explorer links are derived from the actual chain and reference type; an arbitrary fingerprint is not presented as a transaction. Unknown networks keep copy/expand controls. Missing blocks, transactions, ownership or contract audits are never invented.

## Artwork client

Verified artwork receives the frozen `globalThis.__KEEL_SHELL__` client before its own scripts execute. It works across the artwork's opaque iframe using source-bound messages; it does not require `allow-same-origin`, DOM access, RPC access or network permission.

```js
await __KEEL_SHELL__.putPanel({
  id: "race",
  title: "Race details",
  description: "Information reported by REDLINE.",
  rows: [
    { label: "Car", value: "Marauder Mule" },
    { label: "Wins", value: "12" },
    { label: "Rules", value: "Read the game rules", href: "https://onkeel.io/docs" }
  ]
});
await __KEEL_SHELL__.open("application");
const proof = await __KEEL_SHELL__.verification(); // read only
const catalog = await __KEEL_SHELL__.catalog(); // checked file descriptions and declarations
await __KEEL_SHELL__.removePanel("race");
```

A host embedding the complete KEEL shell can use `createKeelShellClient(frame.contentWindow)` from `@keel/sdk`. Requests return promises and reject invalid input, blocked actions, overload or timeouts. Call `dispose()` when an external client is removed. Trusted shell integrations have `__KEEL_SHELL_API__` (existing `keel-shell-plugin@1`, `version: 2`) with synchronous `putPanel`, `removePanel`, `verification`, `catalog`, `resources`, `plugins`, `open` and `close`. Existing read-only callers remain supported.

Supported pages are `overview`, `token`, `sources`, `provenance` and `application`. Custom presentation manifests may supply other proof page IDs; unsupported IDs fall back to the first available page.

## App data and file evidence

App panels may use the supported standard pages or their own App page, labelled APPLICATION DATA and their source (artwork, host or integration). The App tab exists only while an app panel uses it. They cannot modify the KEEL result, checks, token identity, revisions or core panel markup. A label like “verified” supplied by an app is just application text.

To attach evidence, supply the exact ID and digest of an already checked resource:

```js
const proof = await __KEEL_SHELL__.verification();
const resource = proof.checks.find(check => check.id === "rules.json" && check.passed);
if (resource?.digest) await __KEEL_SHELL__.putPanel({
  id: "rules", title: "Game rules", rows: [{
    label: "Rules file", value: "Published rules", evidence: {
      resourceId: resource.id, digest: resource.digest
    }
  }]
});
```

Only the shell decides whether the evidence matches. “Matches checked file” certifies those file bytes, not a score, ownership, external API response or the truth of an app claim. Unmatched evidence is visibly marked. There is no `setVerified`, custom green proof badge, injected HTML, callback or code execution API. New proof types need an independently reviewed verifier module and its own defined proof scope.

## Limits and trust boundaries

- At most eight panels across all sources. IDs are namespaced by source; a host cannot overwrite an artwork panel.
- IDs: 32 lowercase letters/digits/hyphens. Titles and row labels: 64 characters. Description: 512 characters. At most 32 rows; values: 2,048 characters; total panel: 16 KiB.
- Links: HTTP(S), no embedded credentials. Values are inserted with `textContent`. No HTML, CSS, JavaScript, DOM selectors or event callbacks.
- Only the registered artwork iframe and embedding parent can issue extension messages. Opaque `null` origins are never used as identity. The exact `event.source` is checked.
- Per-source message updates are limited to one every 80 ms. Clients permit at most 16 pending requests. Update after meaningful state changes, not every animation frame.
- A verification failure remains a failure. Later app updates cannot clear it or restore passed resource evidence.

## Catalog and metadata

`catalog()` reports `keel-shell-catalog@1`: resources (role, MIME type, compression, import handles, byte counts and shared container), checked JSON manifests, metadata/attributes, plugin declarations and external declarations. JSON parsing is bounded and never executes a plugin or fetches a declaration. Each checked JSON entry retains its source resource ID and digest. A checked manifest proves its bytes, not the claims of an external service. Supplied token metadata is separately labelled as reader-supplied; missing metadata or traits are not invented.

The default seal retains its original reveal-on-hover/focus/touch and auto-hide behavior. The panel uses one OnKEEL glyph, embedded site fonts/tokens, and the site's white hover plate, indigo offset shadow and pressed scale. Custom manifests can rearrange the built-in panel types without changing checks.

## Release boundary

Changing source or SDK packages does not update an existing onchain shell. Publication must register/revise the canonical shell through its governed route, preserve existing game/resource objects, and verify the complete returned tokenURI and browser rendering. Measure the added wrapper bytes and read gas; do not quote compressed game size as the complete token size. Current prepared REDLINE mint artifacts stay frozen until that separate mint is complete.

## Optional live information

`optionalMarketplaceInfo` explicitly opts a canonical Inline build into background
listing checks using KEEL's governed hybrid RPC transport. This does not select
Hybrid delivery or load any art resource from RPC. The reader verifies endpoint
chain IDs, pins reads to one block hash, checks ownership/approval and native
listing or Seaport cancellation/fill/counter state, coalesces concurrent requests
and uses a bounded cache. Denied/blocked/offline calls never enter the required
resource verification failure path or delay the first artwork paint.

OnKEEL's gallery link is permanent. Other links require current token-specific
listing evidence and disappear when that evidence expires. Offchain marketplace
orders need a fresh marketplace-feed adapter; RPC does not discover those orders
or authenticate their reported price/signature. No provider-homepage fallback is
shown as an active listing. Feed evidence is labelled separately from file proof.
Host integrations may use `setMarketplaces`; sandboxed artwork cannot overwrite
the host's marketplace directory or core verification.

Optional prereveal checks use `@keel/sdk/pre-reveal`, preserve this same failure
boundary and distinguish exact art, assigned traits and generator rules. See
[the prereveal guide](KEEL_PREREVEAL.md). Hidden proofs and encryption keys are
never attached to the public verification catalog before intentional reveal.
