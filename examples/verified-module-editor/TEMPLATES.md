# KEEL templates and background previews

Open `KEEL.code-workspace` in VS Code, then `src/template.tsx`. This is KEEL's JSX runtime: it uses native DOM elements and ordinary SDK modules, with no React dependency. Existing JavaScript and TypeScript modules continue to work.

```tsx
import { defineTemplate, signal } from '@keel/sdk/module';
const title = signal('My work');
export default defineTemplate({ name: 'my-work', title: 'My work', target: '@keel/eth/sepolia' },
  <main>
    <input value={title} onInput={event => { title.value = event.currentTarget.value; }} />
    <h1>{title}</h1>
  </main>
);
```

Use `() => expression` for computed children and attributes. Components are ordinary functions returning JSX. Text children remain text. Events receive DOM events, including typed `currentTarget`. This initial runtime updates reactive regions; it does not implement React hooks or keyed list reconciliation.

Run the example's build with `node build.mjs src/template.tsx`. The builder lowers JSX and injects the selected module bindings into ordinary browser JavaScript before publication.

## Capture without a button

`src/capture.tsx` is a complete typed example. Build it with `node build.mjs src/capture.tsx`.

Include `thumbnail-capture`, then use the generated `thumbnail` binding. Mark the actual canvas with `data-keel-thumbnail` when there is more than one image or canvas. Studio copies its intrinsic pixels, with proportional downscaling, rather than taking a framed screenshot.

```ts
thumbnail.init();
await initializeArtwork();
drawArtwork();
thumbnail.snapshot();
```

`init()` prevents Studio's automatic load-time poster capture while initialization is unfinished. `snapshot()` captures the current pixels synchronously, before image encoding. The generated poster can supply the metadata image without an uploaded placeholder.

For a small animated preview, add `data-keel-thumbnail-motion="12"` to that canvas. `snapshot()` starts sampling; `thumbnail.stop()` ends the sequence. This capture runs in the background. Limits are 256 pixels on the longest side, 1–30 samples per second, 120 frames, and 30 seconds. The bounded sequence is encoded as animated AVIF by the builder's hash-checked FFmpeg adapter. Hosts without a reviewed encoder report an error; the still WebP remains available. AVIF uses lossy color compression and currently does not preserve alpha.

The preview files are derivatives, not replacements for the original artwork. Verify marketplace support for animated AVIF for the intended destination. No deployment or marketplace read-back is implied by local capture.
