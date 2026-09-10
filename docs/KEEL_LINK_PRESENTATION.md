# External link presentation

`buildKeelLinkPresentationCall` prepares `presentationURI(linkId, shellId)`.
The result is a browser-ready `data:text/html;base64,...` URI containing the
registered shell and the link's committed descriptor. Omitting `shellId` selects
KEEL's canonical Inline verification shell.

```ts
const request = buildKeelLinkPresentationCall({ linkRegistry, linkId });
const presentationURI = await publicClient.readContract({
  address: request.to,
  abi: parseAbi(keelLinkRegistryAbi),
  functionName: request.functionName,
  args: request.arguments,
});
// Use as the viewer URL / animation_url. This HTML URI is not NFT metadata JSON.
```

HTTPS and IPNS always require the canonical shell. Passing zero (no viewer) or a
custom shell ID reverts. IPFS and Arweave allow either: zero returns the original
protocol URI, while a nonzero shell ID selects a registered assembler.
`buildKeelLinkURICall` also returns raw IPFS/Arweave locators and denies HTTPS/IPNS.
No scheme supplied by the caller can override the stored declaration.

The browser fetches a declared external resource once for that load, checks its
decoded length and SHA-256 or Keccak-256 digest, and creates the isolated artwork
frame from those exact verified bytes. It never navigates the artwork frame back
to the original URL. Each subsequent load repeats verification. The frame retains
its network-denying CSP and opaque origin. CORS failures, redirects, over-limit
responses, malformed compressed bodies and digest mismatches fail closed.

## Builder configuration

`KeelLinkURIBuilder` pins raw, uncompressed Hold objects containing the exact
canonical prefix/suffix from `buildKeelInlineShellFragments`. For direct media,
provide the raw slot produced by `buildKeelInlineModuleFragment` for the canonical
`keel.asset-display` module as `assetDisplayObjectId`; zero disables direct media.
Fragment length and SHA-256 digest are checked against Hold records at construction
and on reads. A prefix/suffix pair must belong to the same canonical build.

Its immutable configuration also includes a maximum response size and optional
HTTPS gateway bases for IPFS/IPNS and Arweave. The maximum applies to both stored
response bytes and declared decoded length; decompression is additionally bounded
by the exact declared length. Gateway bases end in `/`; the IPFS base receives
`ipfs/` or `ipns/` and the Arweave base receives the transaction path.

Through the existing KeelManager governance lane, register the builder with
`setPresentationBuilder(shellId, builder)`. The registry checks its own address
and the shell ID against the builder. Registering zero disables the assembled
route. To change limits, gateways or shell code, governance registers a replacement
builder with new pinned configuration. Missing or disabled builders never fall
back to a raw mutable URL. Raw IPFS/Arweave reads need no builder.

Governance must approve the exact canonical shell fragments for the canonical ID;
a matching ID alone is not a cryptographic review of arbitrary builder code.
Custom viewers use their own registered builder and remain available only for
immutable IPFS/Arweave delivery under this API.

This compact builder supports HTML and the canonical image/video/GLB display
profile, with uncompressed, Gzip or Deflate responses. Brotli and other entrypoint
formats need a separately reviewed decoder/display profile. They fail explicitly
in this route; publication of their link declarations is unaffected. HTTPS origins
and configured gateways must permit browser CORS requests from the viewer.

`linkForPresentation`, `linkById` and `fidelityLink` remain metadata inspection
calls. Do not use them as a fallback after a presentation policy error. A VM proof
never exempts HTTPS from the canonical shell. This change includes no deployment,
VM adapter, signing, or automatic activation on an existing chain.

## Local integration test

Compile the LinkRegistry/URIBuilder Solidity tests in the contracts checkout,
build `@keel/sdk`, then run:

```sh
node --test tests/link-presentation.test.mjs tests/link-assembly-browser.test.mjs
```

The browser integration requires Anvil, OpenSSL, headless Chrome and compiled
contracts. `KEEL_CONTRACTS_ROOT` and `KEEL_CHROME_HEADLESS_SHELL` override their
locations. It starts and stops its own loopback EVM and HTTPS server. The real
registry and builder return the URI loaded by Chrome; Hold and authority are
fixtures. Only that local browser process exempts its self-signed certificate
and loopback address-space restriction; ordinary CORS remains enabled and tested.
