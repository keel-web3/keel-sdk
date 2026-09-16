// Capture: getting pictures out of a running project -- a still, a video, a
// GIF. All of it is optional: a game never needs any of it, and nothing here
// is imported unless a page asks for it (a KEEL bundle only carries what its
// entry imports). The GIF encoder in particular is loaded on first use, and
// only for GIFs.
//
//   const cap = createCapture(canvas, { renderer: px, step: (dt) => sim.simulate(dt), draw });
//   await cap.png()                                  // the canvas as it is, full colour
//   await cap.video({ seconds: 20 })                 // WebM of whatever plays, as it plays (blown up, crisp)
//   await cap.film({ seconds: 20, fps: 30 })         // WebM stepped frame by frame: the same every time
//   await cap.gif({ seconds: 8, fps: 25 })           // a GIF (up to 256 colours -- pixel art fits)
//   await cap.save(blob, "out/clip.webm")            // PUT to the dev server (tools/serve.mjs), or a download
//
// Video keeps every colour and every frame the game draws; a GIF is the
// art-piece format (NOCTURNES' loops), handy for sharing a pixel-art clip, and
// refuses a picture with more colours than a GIF table holds rather than
// quietly posterising it.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * createCapture(canvas, { renderer, step, draw })
 *   canvas    the canvas the game draws on
 *   renderer  optional: something with read() -> RGBA, bottom row first (src/gpu/pixel-renderer.js),
 *             for exact pixels; without it the canvas is read through a 2D copy
 *   step(dt)  advance the game by dt seconds without drawing (for film and gif: fixed steps)
 *   draw()    draw the game's current state
 */
export function createCapture(canvas, { renderer = null, step = null, draw = null } = {}) {
  const needFixed = (what) => { if (!step || !draw) throw new Error(`${what} steps the game itself: createCapture needs step(dt) and draw().`); };

  // The picture's pixels, top row first, RGBA.
  function pixels() {
    const W = canvas.width;
    const H = canvas.height;
    if (renderer?.read) {
      const src = renderer.read();
      const out = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y += 1) out.set(src.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      return { W, H, rgba: out };
    }
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext("2d");
    g.drawImage(canvas, 0, 0);
    return { W, H, rgba: g.getImageData(0, 0, W, H).data };
  }

  // (Video codecs halve colour resolution: at 128 px that smears pixel art. So video records a copy blown up
  // with nearest-neighbour -- 4x for small pictures, never past ~1080 -- where every pixel is a crisp block.)
  function blownUp(scale) {
    const k = scale ?? Math.max(1, Math.min(8, Math.floor(1080 / Math.max(canvas.width, canvas.height))));
    if (k === 1) return { target: canvas, copy: () => {} };
    const big = document.createElement("canvas");
    big.width = canvas.width * k;
    big.height = canvas.height * k;
    const g = big.getContext("2d");
    const copy = () => { g.imageSmoothingEnabled = false; g.drawImage(canvas, 0, 0, big.width, big.height); };
    copy();
    return { target: big, copy };
  }

  function recorder(stream, type) {
    const mime = [type, "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => t && MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = () => r(new Blob(chunks, { type: mime })); });
    return { rec, done };
  }

  return {
    /** The canvas now, as a PNG (full colour, exact size -- scale it up with nearest-neighbour if you want it bigger). */
    async png() {
      draw?.();
      return new Promise((r) => canvas.toBlob(r, "image/png"));
    },

    /** Record what plays, as it plays (the game's own loop keeps running). */
    async video({ seconds = 10, fps = 60, type = null, scale = null } = {}) {
      const { target, copy } = blownUp(scale);
      let on = true;
      const pump = () => { if (!on) return; copy(); requestAnimationFrame(pump); };
      pump();
      const { rec, done } = recorder(target.captureStream(fps), type);
      rec.start(250);
      await sleep(seconds * 1000);
      on = false;
      rec.stop();
      return done;
    },

    /**
     * Film frame by frame at a fixed rate: step, draw, hand the frame over,
     * wait a frame's time (the recorder stamps real time). The same seed films
     * the same clip every time. Pause the game's own loop while it runs.
     */
    async film({ seconds = 10, fps = 30, type = null, scale = null } = {}) {
      needFixed("film");
      const { target, copy } = blownUp(scale);
      const stream = target.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const { rec, done } = recorder(stream, type);
      rec.start();
      for (let f = 0; f < Math.round(seconds * fps); f += 1) {
        step(1 / fps);
        draw();
        copy();
        track.requestFrame();
        await sleep(1000 / fps);
      }
      rec.stop();
      return done;
    },

    /**
     * A GIF, stepped at a fixed rate. The colour table is the colours the clip
     * actually uses (or `palette`, if given): up to 256 -- a pixel-art palette
     * fits; a picture with more colours is refused (film it instead).
     */
    async gif({ seconds = 8, fps = 25, palette = null, loop = 0 } = {}) {
      needFixed("gif");
      const { encodeGif } = await import("../core/gif.js");
      const index = new Map();
      const colours = [];
      if (palette) palette.forEach((c) => { const k = (c[0] << 16) | (c[1] << 8) | c[2]; if (!index.has(k)) { index.set(k, colours.length); colours.push([c[0], c[1], c[2]]); } });
      const frames = [];
      let W = 0;
      let H = 0;
      for (let f = 0; f < Math.round(seconds * fps); f += 1) {
        step(1 / fps);
        draw();
        const p = pixels();
        W = p.W; H = p.H;
        const out = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i += 1) {
          const k = (p.rgba[i * 4] << 16) | (p.rgba[i * 4 + 1] << 8) | p.rgba[i * 4 + 2];
          let n = index.get(k);
          if (n === undefined) {
            if (colours.length >= 255) throw new RangeError("More colours than a GIF holds (255 and a see-through slot): film() it instead.");
            n = colours.length; index.set(k, n); colours.push([p.rgba[i * 4], p.rgba[i * 4 + 1], p.rgba[i * 4 + 2]]);
          }
          out[i] = n;
        }
        frames.push({ pixels: out, delay: Math.round(100 / fps) });
      }
      return new Blob([encodeGif({ width: W, height: H, palette: colours, frames, loop })], { type: "image/gif" });
    },

    /** Keep it: PUT to a dev server path (tools/serve.mjs takes PUTs into out/), or offer it as a download. */
    async save(blob, path, { put = true } = {}) {
      if (put) {
        const r = await fetch(path, { method: "PUT", body: blob }).catch(() => null);
        if (r?.ok) return path;
      }
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: path.split("/").pop() });
      a.click();
      return a.download;
    },
  };
}
