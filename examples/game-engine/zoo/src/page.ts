// The zoo on a page: a top-down pen on a canvas -- each animal a dot the size
// of its body with an arrow for its facing (a ring when it sits, red when it
// runs, a halo on a herd's leader), the people standing along the bottom, the
// wolf a red cross -- and beside it what the page loaded and who's wearing
// what. Placeholder drawing: no bake, no renderer; it proves the modules
// compose. Click the pen to put the wolf there.

import { DT, OBSTACLES, PEN } from "./zoo.ts";
import type { Animal, Person, Worn, Zoo } from "./zoo.ts";

const css = (c: readonly number[], a = 1): string => `oklch(${c[0]} ${c[1]} ${c[2]} / ${a})`;
const esc = (s: string): string => s.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));
const pinText = (w: Worn): string => Object.entries(w.pins).map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(2).replace(/\.?0+$/, "") : String(v)}`).join(", ");

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0e1015; color: #c9cedc; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .zoo { display: flex; gap: 18px; padding: 18px; align-items: flex-start; flex-wrap: wrap; }
  .pen { flex: 0 0 auto; }
  canvas { display: block; border: 1px solid #2a2f3c; border-radius: 6px; cursor: crosshair; background: #16241a; }
  .side { flex: 1 1 340px; min-width: 300px; max-width: 520px; }
  h1 { font-size: 15px; letter-spacing: 0.2em; margin: 0 0 4px; color: #e9ecf4; }
  h2 { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #8a91a6; margin: 16px 0 6px; font-weight: 600; }
  .muted { color: #737a8f; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 3px 0; border-bottom: 1px solid #1c2029; }
  .sw { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  .tag { color: #9fb4ff; }
  .cloth { color: #e7c98f; }
  .legend { margin-top: 8px; color: #737a8f; }
`;

export function mount(host: HTMLElement, zoo: Zoo): void {
  const doc = host.ownerDocument;
  const style = doc.createElement("style");
  style.textContent = STYLE;
  doc.head.append(style);
  host.innerHTML = "";
  const root = doc.createElement("div");
  root.className = "zoo";
  host.append(root);

  // ---- the pen
  const W = 760;
  const scale = W / (PEN[2] - PEN[0]);
  const H = Math.round((PEN[3] - PEN[1]) * scale);
  const pen = doc.createElement("div");
  pen.className = "pen";
  const canvas = doc.createElement("canvas");
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const legend = doc.createElement("div");
  legend.className = "legend";
  legend.textContent = "dot = body size, line = facing · ring = sitting · red = fleeing · halo = herd leader · click the pen to set the wolf there";
  pen.append(canvas, legend);
  root.append(pen);
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);
  // (Top-down: +x to the right, +z up the screen.)
  const X = (x: number) => (x - PEN[0]) * scale;
  const Y = (z: number) => (PEN[3] - z) * scale;

  canvas.addEventListener("click", (ev) => {
    const r = canvas.getBoundingClientRect();
    zoo.scare([PEN[0] + (ev.clientX - r.left) / scale, 0, PEN[3] - (ev.clientY - r.top) / scale]);
  });

  // ---- the side: what loaded, the animals, the people
  const side = doc.createElement("div");
  side.className = "side";
  const groups = new Map<string, Animal[]>();
  for (const a of zoo.animals) groups.set(a.entity, [...(groups.get(a.entity) ?? []), a]);
  const animalRows = [...groups.entries()].map(([id, list]) => {
    const worn = [...new Set(list.flatMap((a) => a.worn.map((w) => w.attribute)))];
    return `<li><span class="sw" style="background:${css(list[0]!.spec.colours.fur)}"></span>${esc(id)} ×${list.length} <span class="tag">${esc(list[0]!.ai)}</span> <span class="muted">${esc(list[0]!.pack)}</span>${worn.length ? ` · <span class="cloth">${esc(worn.join(", "))}</span>` : ""}</li>`;
  });
  const personRow = (p: Person, i: number) =>
    `<li><span class="sw" style="background:${css(p.spec.colours.cloth)}"></span><b>${i + 1}</b> ${esc(p.entity)} <span class="muted">${esc(p.pack)}</span><br>${p.worn.length ? p.worn.map((w) => `&nbsp;&nbsp;<span class="cloth">${esc(w.attribute)}</span> <span class="muted">(${esc(w.slot)}: ${esc(pinText(w))}; ${w.parts} parts)</span>`).join("<br>") : '&nbsp;&nbsp;<span class="muted">nothing that fits</span>'}</li>`;
  side.innerHTML = `
    <h1>ZOO</h1>
    <div class="muted">packs, wearables and animal AI, each its own KEEL module, composed by contract</div>
    <h2>Loaded</h2>
    <ul>
      <li>bodies <span class="tag">${esc(zoo.sources.bodies.join(", "))}</span></li>
      <li>wearables <span class="tag">${esc(zoo.sources.wearables.join(", "))}</span></li>
      <li>behaviour <span class="tag">${esc(zoo.sources.ais.join(", "))}</span></li>
    </ul>
    <h2>Animals (${zoo.animals.length})</h2>
    <ul>${animalRows.join("")}</ul>
    <h2>People, dressed in what fits</h2>
    <ul>${zoo.people.map(personRow).join("")}</ul>
    <h2>Now</h2>
    <div id="now" class="muted"></div>`;
  root.append(side);
  const now = side.querySelector("#now") as HTMLElement;

  // ---- drawing
  function draw(): void {
    g.fillStyle = "#16241a";
    g.fillRect(0, 0, W, H);
    // (A faint metre grid.)
    g.strokeStyle = "rgba(255,255,255,0.04)";
    g.lineWidth = 1;
    for (let x = Math.ceil(PEN[0]); x <= PEN[2]; x += 1) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); }
    for (let z = Math.ceil(PEN[1]); z <= PEN[3]; z += 1) { g.beginPath(); g.moveTo(0, Y(z)); g.lineTo(W, Y(z)); g.stroke(); }
    for (const o of OBSTACLES) {
      g.fillStyle = "#2b3a4e";
      g.beginPath(); g.arc(X(o.pos[0]), Y(o.pos[2]), o.r * scale, 0, Math.PI * 2); g.fill();
    }
    // The people, standing along the bottom, facing the pen.
    zoo.people.forEach((p, i) => {
      const x = X(p.pos[0]);
      const y = Y(p.pos[2]);
      const r = Math.max(6, p.spec.body.H * 5);
      g.fillStyle = css(p.spec.colours.cloth);
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.fillStyle = css(p.spec.colours.fur);
      g.beginPath(); g.arc(x, y - r - 3, r * 0.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0e1015";
      g.font = "bold 10px ui-monospace, Menlo, monospace";
      g.textAlign = "center";
      g.fillText(String(i + 1), x, y + 3.5);
      g.fillStyle = "#e7c98f";
      g.fillText("•".repeat(Math.min(5, p.worn.length)), x, y + r + 10);
    });
    // The animals.
    for (const a of zoo.animals) {
      const { pos, facing, mode } = a.agent;
      const x = X(pos[0]);
      const y = Y(pos[2]);
      const r = Math.max(2.5, a.length * 0.5 * scale);
      const L = Math.max(7, a.length * scale * 0.9);
      if (a.leader) { g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = mode === "flee" ? "#ff5a4f" : "rgba(235,240,255,0.8)";
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(facing) * L, y - Math.cos(facing) * L); g.stroke();
      g.fillStyle = css(a.spec.colours.fur);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      if (mode === "flee") { g.strokeStyle = "#ff5a4f"; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 1.5, 0, Math.PI * 2); g.stroke(); }
      if (mode === "sit") { g.strokeStyle = "#9fb4ff"; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r + 2.5, 0, Math.PI * 2); g.stroke(); }
      if (a.worn.length) { g.fillStyle = "#e7c98f"; g.fillRect(x - 1.5, y - r - 4, 3, 3); }
    }
    const w = zoo.wolf();
    if (w) {
      const x = X(w[0]);
      const y = Y(w[2]);
      g.strokeStyle = "#ff5a4f"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.stroke();
    }
    const modes = new Map<string, number>();
    for (const a of zoo.animals) modes.set(a.agent.mode, (modes.get(a.agent.mode) ?? 0) + 1);
    now.textContent = `t ${(zoo.tick * DT).toFixed(1)} s · ${[...modes.entries()].map(([m, n]) => `${m} ${n}`).join(" · ")}${w ? " · the wolf is out" : ""}`;
  }

  // ---- the loop: the model on its fixed step, drawing whenever a frame comes
  let last = -1;
  let owed = 0;
  const frame = (t: number) => {
    if (last >= 0) owed = Math.min(owed + (t - last) / 1000, 0.25);
    last = t;
    while (owed >= DT) { zoo.step(); owed -= DT; }
    draw();
    requestAnimationFrame(frame);
  };
  // (Let the animals settle before the first picture.)
  for (let i = 0; i < 30 * 4; i += 1) zoo.step();
  draw();
  requestAnimationFrame(frame);
}
