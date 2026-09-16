// WALLRUN as a KEEL piece: one picture filling the window, the course and the
// runner from the token's seed (KEEL.data.token.seed when minted; ?seed= or
// #n when previewed), ?px= for the pixel size (32..256, 128 by default). It
// runs itself; click it and it's yours (the mouse looks, W runs where you
// look, space jumps); leave it and it runs itself again.

import { createGame } from "./game.js";

const q = new URLSearchParams(location.search);
const token = globalThis.KEEL?.data?.token;
const seed = String(token?.seed ?? q.get("seed") ?? (location.hash.slice(1) || "1"));
const px = Math.max(16, Math.min(256, Number(q.get("px") ?? token?.px ?? 128) || 128));

document.body.style.cssText = "margin:0;height:100vh;display:grid;place-items:center;background:#07080b;overflow:hidden";
const canvas = document.createElement("canvas");
canvas.style.cssText = "width:min(100vw,100vh);height:min(100vw,100vh);image-rendering:pixelated;cursor:crosshair";
document.body.append(canvas);

const game = createGame(canvas, { seed, width: px, height: px });
game.attachInput(globalThis);
globalThis.WALLRUN = game;

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  game.tick((now - last) / 1000);
  last = now;
}
requestAnimationFrame(loop);
