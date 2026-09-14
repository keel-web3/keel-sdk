// The loading screen: a low-resolution picture scaled up pixel for pixel -- a
// 3x5 bitmap font, a dithered progress bar, the phase the preload is in and
// the real counts (sprites baked of those the opening needs). It draws a
// frame at a time, so the page stays live while the bake runs.

// 3x5 glyphs, rows left to right ("#" set).
const GLYPHS: Readonly<Record<string, string>> = {
  A: ".#. #.# ### #.# #.#", B: "##. #.# ##. #.# ##.", C: ".## #.. #.. #.. .##", D: "##. #.# #.# #.# ##.", E: "### #.. ##. #.. ###", F: "### #.. ##. #.. #..",
  G: ".## #.. #.# #.# .##", H: "#.# #.# ### #.# #.#", I: "### .#. .#. .#. ###", J: "..# ..# ..# #.# .#.", K: "#.# #.# ##. #.# #.#", L: "#.. #.. #.. #.. ###",
  M: "#.# ### ### #.# #.#", N: "##. #.# #.# #.# #.#", O: ".#. #.# #.# #.# .#.", P: "##. #.# ##. #.. #..", Q: ".#. #.# #.# ##. .##", R: "##. #.# ##. #.# #.#",
  S: ".## #.. .#. ..# ##.", T: "### .#. .#. .#. .#.", U: "#.# #.# #.# #.# ###", V: "#.# #.# #.# #.# .#.", W: "#.# #.# ### ### #.#", X: "#.# #.# .#. #.# #.#",
  Y: "#.# #.# .#. .#. .#.", Z: "### ..# .#. #.. ###", 0: "### #.# #.# #.# ###", 1: ".#. ##. .#. .#. ###", 2: "##. ..# .#. #.. ###", 3: "##. ..# .#. ..# ##.",
  4: "#.# #.# ### ..# ..#", 5: "### #.. ##. ..# ##.", 6: ".## #.. ### #.# ###", 7: "### ..# .#. .#. .#.", 8: "### #.# ### #.# ###", 9: "### #.# ### ..# ##.",
  "/": "..# ..# .#. #.. #..", ".": "... ... ... ... .#.", ":": "... .#. ... .#. ...", "-": "... ... ### ... ...", "%": "#.# ..# .#. #.. #.#", "·": "... ... .#. ... ...",
  " ": "... ... ... ... ...", "+": "... .#. ### .#. ...", "(": ".#. #.. #.. #.. .#.", ")": ".#. ..# ..# ..# .#.",
};
const cells = (g: string): string => g.replace(/ /g, "");

export interface LoadingState {
  readonly title: string;
  readonly subtitle: string;
  readonly phase: string;
  readonly done: number;
  readonly total: number;
  readonly footer: string;
}

export interface LoadingScreen {
  readonly element: HTMLCanvasElement;
  draw(state: LoadingState, time: number): void;
  remove(): void;
}

const W = 256, H = 144;
const INK = "#d8dcf0", DIM = "#6a7090", BG = "#0a0b12", BG2 = "#131626";
const RAMP = ["#1f3a2a", "#2f5c3a", "#4a8a48", "#7dbb5c", "#c4e58a"];
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function createLoadingScreen(host: HTMLElement): LoadingScreen {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;image-rendering:pixelated;background:#0a0b12;z-index:2";
  host.append(canvas);
  const g = canvas.getContext("2d")!;
  const text = (s: string, x: number, y: number, colour: string, scale = 1) => {
    g.fillStyle = colour;
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const glyph = GLYPHS[ch];
      if (glyph) { const c = cells(glyph); for (let i = 0; i < 15; i += 1) if (c[i] === "#") g.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale); }
      cx += 4 * scale;
    }
  };
  const width = (s: string, scale = 1) => s.length * 4 * scale - scale;
  const centred = (s: string, y: number, colour: string, scale = 1) => text(s, Math.round((W - width(s, scale)) / 2), y, colour, scale);
  return {
    element: canvas,
    draw(st, time) {
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      // (A sparse dither on the ground, drifting slowly.)
      g.fillStyle = BG2;
      const drift = Math.floor(time / 180) & 3;
      for (let y = 0; y < H; y += 1) for (let x = (y + drift) & 3; x < W; x += 4) if (BAYER4[(y & 3) * 4 + (x & 3)]! < 2) g.fillRect(x, y, 1, 1);
      centred(st.title, 22, INK, 4);
      centred(st.subtitle, 50, DIM);
      centred(st.phase, 70, INK);
      // The bar: a frame, the ramp's fill, a dithered leading edge.
      const bx = 48, by = 82, bw = 160, bh = 8;
      g.fillStyle = DIM; g.fillRect(bx - 1, by - 1, bw + 2, 1); g.fillRect(bx - 1, by + bh, bw + 2, 1); g.fillRect(bx - 1, by, 1, bh); g.fillRect(bx + bw, by, 1, bh);
      const t = st.total ? Math.min(1, st.done / st.total) : 0;
      const fill = t * bw;
      for (let y = 0; y < bh; y += 1) for (let x = 0; x < bw; x += 1) {
        const edge = (fill - x) / 6; // (the last 6 px dither out)
        if (edge <= 0) continue;
        if (edge < 1 && (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 > edge) continue;
        g.fillStyle = RAMP[Math.min(RAMP.length - 1, Math.floor(((bh - 1 - y) / bh) * RAMP.length + (x / bw) * 1.2))]!;
        g.fillRect(bx + x, by + y, 1, 1);
      }
      centred(`${st.done} / ${st.total} SPRITES  ${Math.floor(t * 100)}%`, 96, INK);
      centred(st.footer, 112, DIM);
      // (A walker's four pixels circling, so a stall shows as a stall.)
      const a = (time / 90) % 8;
      for (let i = 0; i < 4; i += 1) { const p = (Math.floor(a) + i * 2) % 8; const dx = [0, 1, 2, 2, 2, 1, 0, 0][p]!, dy = [0, 0, 0, 1, 2, 2, 2, 1][p]!; g.fillStyle = i === 0 ? INK : DIM; g.fillRect(W / 2 - 1 + dx, 126 + dy, 1, 1); }
    },
    remove() { canvas.remove(); },
  };
}
