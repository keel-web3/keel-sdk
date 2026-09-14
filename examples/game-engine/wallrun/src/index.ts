// WALLRUN as a KEEL piece: one picture filling the window, the course and the
// runner from the token's seed (KEEL.data.token.seed when minted; ?seed= or
// #n when previewed), ?px= for the pixel size (16..256, 128 by default). It
// runs itself; click it and it's yours (the mouse looks, W runs where you
// look, space jumps); leave it and it runs itself again.
// (Nothing here touches the page until main() runs: Node imports it for tests.)

import type { EventTargetLike } from "@keel/game-engine/input";
import { createGame } from "./game.ts";
import type { Game } from "./game.ts";

export { createSim, runnerSpecOf, screenFor, STEP } from "./sim.ts";
export type { Driver, Frame, Look, Sim, SimOptions } from "./sim.ts";
export { createGame } from "./game.ts";
export type { Game, GameOptions } from "./game.ts";
export { levelOf, PIECE_MATS } from "./level.ts";
export type { Level, RouteAct } from "./level.ts";
export { MATERIALS, RUNNER_MATERIALS, paletteOf } from "./palette.ts";
export type { Palette, Rgb } from "./palette.ts";
export { streamOf } from "./seed.ts";

interface KeelPage { KEEL?: { data?: { token?: { seed?: unknown; px?: unknown } } }; KEEL_SEED?: string; WALLRUN?: Game }

export function main(host: HTMLElement): Game {
  const page = globalThis as typeof globalThis & KeelPage;
  const q = new URLSearchParams(location.search);
  const token = page.KEEL?.data?.token;
  const seed = String(token?.seed ?? q.get("seed") ?? (location.hash.slice(1) || page.KEEL_SEED || "1"));
  const px = Math.max(16, Math.min(256, Number(q.get("px") ?? token?.px ?? 128) || 128));

  host.style.cssText = "margin:0;height:100vh;display:grid;place-items:center;background:#07080b;overflow:hidden;position:relative";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:min(100vw,100vh);height:min(100vw,100vh);image-rendering:pixelated;cursor:crosshair";
  // (Who's running, how, and who drives: species · body mode · driver.)
  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;left:8px;bottom:6px;font:11px/1.3 ui-monospace,Menlo,monospace;color:#6f7780;pointer-events:none";
  host.append(canvas, hud);

  const game = createGame(canvas, { seed, width: px, height: px, host });
  game.attachInput(globalThis as EventTargetLike);
  page.WALLRUN = game;

  let last = performance.now();
  let hudAt = 0;
  function loop(now: number): void {
    requestAnimationFrame(loop);
    game.tick((now - last) / 1000);
    last = now;
    if (now - hudAt > 250) { hudAt = now; hud.textContent = `${game.runner.species} · ${game.body.mode} · ${game.driver}`; }
  }
  requestAnimationFrame(loop);
  // (A still on request: whoever embeds the page -- a verification shell, a gallery -- may ask for the picture it already shows.)
  addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { protocol?: string; action?: string; advance?: number } | null;
    if (d?.protocol !== "keel-engine-still@1" || d.action !== "still") return;
    if (typeof d.advance === "number" && d.advance > 0) game.simulate(Math.min(d.advance, 30));
    game.draw();
    (e.source as Window | null)?.postMessage({ protocol: "keel-engine-still@1", action: "still", png: canvas.toDataURL("image/png"), width: game.px.width, height: game.px.height }, { targetOrigin: "*" });
  });
  return game;
}
