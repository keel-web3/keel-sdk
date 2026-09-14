// Hello: the smallest game. It asks the registry for every pack providing
// body/blob, builds each entity from a seed, puts the pack's hat on it where
// fits() allows, and draws them -- proving packs, contracts, attributes and
// the KEEL pipeline end to end.

import { fits } from "@keel/game-engine";
import type { ModuleContext, PackDef, Stream } from "@keel/game-engine";

let packs: Array<{ manifest: ModuleContext["manifest"]; api: { pack: PackDef } }> = [];

export function setup(ctx: ModuleContext): void {
  packs = ctx.providers<{ pack: PackDef }>("body/blob");
}

// (A tiny seeded stream: the engine's real ones come with keel/core.)
function streamOf(seed: number): Stream {
  let a = seed >>> 0 || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: <T,>(l: readonly T[]) => l[Math.floor(f() * l.length)] as T, chance: (p) => f() < p };
}

export function main(host: HTMLElement): void {
  const seed = Number((globalThis as { KEEL_SEED?: unknown }).KEEL_SEED ?? 1) || 1;
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  canvas.style.cssText = "width:min(100vw,100vh);height:min(100vw,100vh);image-rendering:pixelated;background:#101018";
  host.style.cssText = "margin:0;display:grid;place-items:center;height:100vh;background:#101018";
  host.append(canvas);
  const g = canvas.getContext("2d")!;
  const S = streamOf(seed);
  let x = 20;
  for (const { manifest, api } of packs) {
    for (const e of api.pack.entities) {
      const d = e.build(S, {}) as { hue: number; size: number };
      const r = 14 * d.size;
      g.fillStyle = `hsl(${d.hue} 60% 55%)`;
      g.beginPath(); g.arc(x, 90 - r, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.fillRect(x - r * 0.4, 88 - r * 1.2, 2, 2); g.fillRect(x + r * 0.3, 88 - r * 1.2, 2, 2);
      for (const a of api.pack.attributes) {
        if (!fits({ def: a, pack: manifest }, { def: e, pack: manifest }).ok) continue;
        const sock = e.sockets(d)["head"];
        if (!sock) continue;
        const h = a.build(S, sock, {}) as { w: number; h: number; hue: number };
        g.fillStyle = `hsl(${h.hue} 70% 60%)`;
        g.beginPath(); g.moveTo(x - h.w * 9, 90 - 2 * r + 2); g.lineTo(x + h.w * 9, 90 - 2 * r + 2); g.lineTo(x, 90 - 2 * r - h.h * 22); g.fill();
      }
      x += 2 * r + 14;
    }
  }
  g.fillStyle = "#8a8fa8"; g.font = "8px monospace"; g.fillText(`seed ${seed} · ${packs.length} pack(s)`, 4, 120);
}
