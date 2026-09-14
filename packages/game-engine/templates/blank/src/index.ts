// __TITLE__: a blank KEEL game. It draws a pixel canvas, moves a walker with
// the arrow keys or WASD on a fixed step, and lists what your own pack holds
// (make things in the editor's Builder tab; they appear here after Save & run).
// Everything runs inside the KEEL verification shell: no network, no storage.
import type { ModuleContext } from "@keel/game-engine";

type Pack = { pack: { entities: readonly { id: string }[]; attributes: readonly { id: string }[] }; objects: readonly unknown[] };
let mine: Pack | null = null;

export function setup(ctx: ModuleContext): void {
  mine = ctx.use<Pack>("__PACK_ID__");
}

// (A seeded stream: the same seed, the same game.)
function streamOf(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function main(host: HTMLElement): void {
  const seedText = String((globalThis as { KEEL_SEED?: unknown }).KEEL_SEED ?? "1");
  const seed = Number.parseInt(seedText.slice(-8), 16) || 1;
  const rand = streamOf(seed);
  const W = 160, H = 120;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H; canvas.tabIndex = 0;
  canvas.style.cssText = "width:min(100vw,133vh);height:min(75vw,100vh);image-rendering:pixelated;background:#0f1117;outline:none";
  host.style.cssText = "margin:0;display:grid;place-items:center;height:100vh;background:#0f1117";
  host.append(canvas);
  canvas.focus();
  const g = canvas.getContext("2d")!;
  const hue = Math.floor(rand() * 360);
  const stars = Array.from({ length: 40 }, () => [Math.floor(rand() * W), Math.floor(rand() * H)] as const);
  const walker = { x: W / 2, y: H / 2 };
  const keys = new Set<string>();
  addEventListener("keydown", (e) => keys.add(e.code));
  addEventListener("keyup", (e) => keys.delete(e.code));
  const step = () => {
    const dx = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
    const dy = (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0);
    walker.x = Math.max(4, Math.min(W - 4, walker.x + dx));
    walker.y = Math.max(4, Math.min(H - 4, walker.y + dy));
  };
  const draw = () => {
    g.fillStyle = "#0f1117"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#2a3040"; for (const [x, y] of stars) g.fillRect(x, y, 1, 1);
    g.fillStyle = `hsl(${hue} 70% 60%)`; g.fillRect(Math.round(walker.x) - 3, Math.round(walker.y) - 3, 7, 7);
    g.fillStyle = "#fff"; g.fillRect(Math.round(walker.x) - 1, Math.round(walker.y) - 1, 1, 1); g.fillRect(Math.round(walker.x) + 1, Math.round(walker.y) - 1, 1, 1);
    g.fillStyle = "#8a93a8"; g.font = "8px monospace";
    g.fillText("__TITLE__", 4, 10);
    const p = mine?.pack;
    const things = p ? [...p.entities.map((e) => e.id), ...p.attributes.map((a) => a.id)] : [];
    g.fillText(things.length ? `pack: ${things.slice(0, 2).join(", ")}${things.length > 2 ? "…" : ""}` : "pack: empty (use the Builder)", 4, H - 6);
  };
  // (A fixed step, separate from drawing: the same input gives the same game.)
  let last = performance.now(), acc = 0;
  const frame = (now: number) => {
    acc = Math.min(acc + (now - last), 250); last = now;
    while (acc >= 1000 / 60) { step(); acc -= 1000 / 60; }
    draw();
    requestAnimationFrame(frame);
  };
  draw();
  requestAnimationFrame(frame);
}
