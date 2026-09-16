# Capture

`src/capture/capture.js` gets pictures out of a running project. It is
**optional**: no game needs it, the renderer knows nothing about it, and a KEEL
bundle only carries it if its entry imports it (`tests/build.test.mjs` checks
that WALLRUN's doesn't).

A game's picture is whatever it draws: any palette size, any number of
materials, full frame rate. GIF is one export format among others -- the
art-piece format NOCTURNES is built around -- not a limit on anything.

```js
import { createCapture } from "../../src/capture/capture.js";
const cap = createCapture(canvas, { renderer: px, step: (dt) => sim.simulate(dt), draw });

await cap.png();                          // the canvas now, exact pixels
await cap.video({ seconds: 20 });         // WebM of what plays, as it plays
await cap.film({ seconds: 20, fps: 30 }); // WebM stepped frame by frame: a seed films the same clip every time
await cap.gif({ seconds: 8, fps: 25 });   // GIF, loaded on first use; refuses more than 255 colours
await cap.save(blob, "../../out/clip.webm"); // PUT to tools/serve.mjs (writes into out/), or a download
```

- **Video is blown up** with nearest-neighbour before it is encoded (4-8x, up
  to about 1080 px): video codecs halve colour resolution, which smears pixel
  art at its native size. Pass `scale: 1` to record the canvas as it is.
- **film** and **gif** step the game themselves: pause the page's own loop
  while they run (WALLRUN's dev page does: `film("name")`, `gif("name")`,
  `snap("name")` in its console).
- **gif** builds its colour table from the colours the clip actually uses (or
  a `palette` you pass). Past 255 colours it throws rather than posterising:
  film it instead.
