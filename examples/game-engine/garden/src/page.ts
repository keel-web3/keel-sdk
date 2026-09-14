// GARDEN's page: the picture, and beside it the LOCKS PANEL -- every control a
// setting at a scope (the palette, dither and fx for the scene; the camera
// mode and particles; the animals' and the hero's species; one object's
// material and visibility), each with a lock box, the whole panel as lock
// text ("scope/key=value;..."), and explain() for each key: who set it, who
// locked it, what the lock shadows. Items (species) regenerate the world, and
// only they change. Ported from the proof of concept's projects/garden/index.html;
// in a KEEL document the page is the sandboxed frame's own body.

import { createPixelRenderer } from "@keel/game-engine/render";
import type { EventTargetLike } from "@keel/game-engine/input";
import { formatLocks, parseLocks } from "@keel/game-engine/world";
import type { LockText, SettingValue, World } from "@keel/game-engine/world";
import { gardenWorld } from "./garden.ts";

const CSS = `
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0b0d0c; color: #cfd6d0; font: 12px/1.45 ui-monospace, Menlo, monospace; }
  .garden { display: grid; grid-template-columns: minmax(0, 1fr) 330px; height: 100%; }
  .garden #stage { display: grid; place-items: center; min-height: 0; min-width: 0; position: relative; }
  .garden canvas { width: min(100%, 100dvh); aspect-ratio: 1; image-rendering: pixelated; background: #000; cursor: crosshair; }
  .garden #hud { position: absolute; left: 10px; top: 8px; color: #e8efe9; text-shadow: 0 1px 2px #000; pointer-events: none; }
  .garden aside { border-left: 1px solid #1d2320; padding: 10px 12px; overflow: auto; }
  .garden h2 { font-size: 11px; letter-spacing: .08em; color: #7d8a82; margin: 14px 0 6px; font-weight: normal; text-transform: uppercase; }
  .garden .row { display: grid; grid-template-columns: 92px 1fr auto; gap: 6px; align-items: center; margin: 4px 0; }
  .garden small { color: #6f7a73; }
  .garden select, .garden input, .garden button { background: #121614; color: inherit; border: 1px solid #28302c; border-radius: 4px; padding: 3px 6px; font: inherit; }
  .garden input[type=text] { width: 100%; box-sizing: border-box; }
  .garden label.lock { display: flex; gap: 3px; align-items: center; color: #9fb3a6; }
  .garden pre { white-space: pre-wrap; background: #0f1311; border: 1px solid #1d2320; padding: 6px; margin: 4px 0; font-size: 11px; color: #aebdb3; max-height: 320px; overflow: auto; }
  .garden .fx { display: flex; gap: 8px; flex-wrap: wrap; }
  .garden #warn { color: #d9b36b; }
  @media (max-width: 760px) {
    html, body { height: auto; }
    .garden { grid-template-columns: 1fr; height: auto; }
    .garden canvas { width: 100%; }
    .garden aside { border-left: 0; border-top: 1px solid #1d2320; }
  }`;

const opts = (list: readonly string[], first: string): string => `<option value="">${first}</option>${list.map((o) => `<option>${o}</option>`).join("")}`;
const lockBox = (name: string, checked = false): string => `<label class="lock"><input type="checkbox" data-lock="${name}"${checked ? " checked" : ""}>lock</label>`;
const PANEL = `
  <div class="row"><span>seed</span><input id="seed" type="text"><button id="dice" title="another seed">new</button></div>
  <div class="row"><span>pixels</span><select id="px">${["32", "48", "64", "96", "128", "192", "256"].map((n) => `<option>${n}</option>`).join("")}</select><span></span></div>
  <small>click the picture to drive (W is where the camera looks, space jumps); idle 8 s and the hero strolls</small>
  <h2>Filters · scene scope</h2>
  <div class="row"><span>palette</span><select id="palette">${opts(["meadow", "dusk", "moss", "noir"], "(project)")}</select>${lockBox("palette")}</div>
  <div class="row"><span>dither</span><select id="dither"><option value="">(auto)</option><option value="0">none</option><option>2</option><option>4</option><option>8</option></select>${lockBox("dither")}</div>
  <div class="row"><span>fx</span><span class="fx">${["dusk", "mist", "lantern", "glow", "vignette", "scanlines"].map((f) => `<label><input type="checkbox" data-fx="${f}">${f}</label>`).join("")}</span>${lockBox("fx")}</div>
  <h2>Systems</h2>
  <div class="row"><span>camera</span><select id="camera">${opts(["orbit", "chase", "frame", "first"], "(auto)")}</select>${lockBox("camera")}</div>
  <div class="row"><span>particles</span><select id="particles"><option value="">(on)</option><option value="false">off</option></select>${lockBox("particles")}</div>
  <h2>Items · regenerate, the rest stays</h2>
  <div class="row"><span>animals</span><select id="animal">${opts(["cat", "dog", "fox", "bear", "rabbit", "mouse", "deer"], "(seed)")}</select>${lockBox("animal", true)}</div>
  <div class="row"><span>hero</span><select id="hero">${opts(["cat", "fox", "bunny", "bear", "mouse", "frog", "dog"], "(seed)")}</select>${lockBox("hero", true)}</div>
  <h2>Per object</h2>
  <div class="row"><select id="obj"></select><select id="mat">${opts(["oak", "teak", "paint", "metal", "hedge"], "(seed)")}</select>${lockBox("mat", true)}</div>
  <div class="row"><span>show</span><select id="show"><option value="">(yes)</option><option value="false">hidden</option></select><span></span></div>
  <h2>Locks (URL)</h2>
  <input id="locks" type="text" spellcheck="false">
  <div id="warn"></div>
  <h2>explain()</h2>
  <pre id="explain"></pre>`;

interface Control { readonly scope: string; readonly key: string; read(): SettingValue | null; readonly item?: boolean }
interface ObjRow { material: string | null; lock: boolean; hidden: boolean }
interface GardenPage { KEEL?: { data?: { token?: { seed?: unknown; px?: unknown } } }; KEEL_SEED?: string; world?: World; GARDEN?: { world: World } }

/** Build the page into `host` (KEEL hands it the document's body) and run the garden. */
export function main(host: HTMLElement): { readonly world: World } {
  const page = globalThis as typeof globalThis & GardenPage;
  const q = new URLSearchParams(location.search);
  const token = page.KEEL?.data?.token;
  let px = Math.max(16, Math.min(256, Number(q.get("px") ?? token?.px ?? 128) || 128));

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  host.innerHTML = `<div class="garden"><div id="stage"><canvas id="c"></canvas><div id="hud"></div></div><aside>${PANEL}</aside></div>`;
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string): T => host.querySelector<T>(`#${id}`)!;
  const boxes = (sel: string): HTMLInputElement[] => [...host.querySelectorAll<HTMLInputElement>(sel)];
  const canvas = $<HTMLCanvasElement>("c");
  const renderer = createPixelRenderer(canvas, { width: px, height: px });
  let world: World = null as unknown as World;
  let detach: (() => void) | null = null;

  const lockOn = (name: string): boolean => Boolean(host.querySelector<HTMLInputElement>(`[data-lock="${name}"]`)?.checked);
  // The panel's controls, each one a setting at a scope (null = not set there).
  const CONTROLS: Record<string, Control> = {
    palette: { scope: "scene", key: "render.palette", read: () => $("palette").value || null },
    dither: { scope: "scene", key: "render.dither.screen", read: () => ($("dither").value === "" ? null : +$("dither").value) },
    fx: { scope: "scene", key: "render.fx", read: () => { const on = boxes("[data-fx]").filter((b) => b.checked).map((b) => b.dataset["fx"]!); return on.length || lockOn("fx") ? on : null; } },
    camera: { scope: "scene", key: "system.camera.mode", read: () => $("camera").value || null },
    particles: { scope: "scene", key: "system.particles.enabled", read: () => ($("particles").value === "false" ? false : null) },
    animal: { scope: "tag:animal", key: "species", read: () => $("animal").value || null, item: true },
    hero: { scope: "id:hero", key: "species", read: () => $("hero").value || null, item: true },
  };
  // Per object: { id: { material, lock, hidden } }, the selected one in the panel.
  const objs: Record<string, ObjRow> = {};
  const extra: Required<LockText>[] = []; // (locks typed in that no control shows: kept as they are)

  // The panel -> [{ scope, key, value, lock }].
  function panelLocks(): LockText[] {
    const out: LockText[] = [];
    for (const [name, c] of Object.entries(CONTROLS)) {
      const v = c.read();
      if (v !== null) out.push({ scope: c.scope, key: c.key, value: v, lock: lockOn(name) });
    }
    for (const [id, o] of Object.entries(objs)) {
      if (o.material) out.push({ scope: `id:${id}`, key: "material", value: o.material, lock: o.lock });
      if (o.hidden) out.push({ scope: `id:${id}`, key: "show", value: false, lock: true });
    }
    for (const l of extra) if (!out.some((o) => o.scope === l.scope && o.key === l.key)) out.push(l);
    return out;
  }

  function build(seed: string, locks: string): void {
    detach?.();
    world = gardenWorld({ seed, width: px, height: px, locks });
    detach = world.attach(globalThis as unknown as EventTargetLike, { canvas });
    page.world = world;
    const ids = [...world.objects.values()].filter((o) => !o.tags.includes("hedge") && !o.tags.includes("ground")).map((o) => String(o.id));
    const keep = $<HTMLSelectElement>("obj").value;
    $<HTMLSelectElement>("obj").innerHTML = ids.map((id) => `<option>${id}</option>`).join("");
    $<HTMLSelectElement>("obj").value = ids.includes(keep) ? keep : ids.find((id) => id.startsWith("bench")) ?? ids[0] ?? "";
    showObj();
    $("warn").textContent = world.warnings.join(" · ");
    explain();
  }
  // The selected object's row from `objs`.
  function showObj(): void {
    const o = objs[$<HTMLSelectElement>("obj").value];
    $<HTMLSelectElement>("mat").value = o?.material ?? "";
    host.querySelector<HTMLInputElement>('[data-lock="mat"]')!.checked = o?.lock ?? true;
    $<HTMLSelectElement>("show").value = o?.hidden ? "false" : "";
  }
  function readObj(): void {
    objs[$<HTMLSelectElement>("obj").value] = { material: $<HTMLSelectElement>("mat").value || null, lock: lockOn("mat"), hidden: $<HTMLSelectElement>("show").value === "false" };
  }

  // (The URL keeps the panel -- where the page may have one: a sandboxed KEEL frame may not.)
  function remember(text: string): void {
    try {
      const url = new URL(location.href);
      url.searchParams.set("seed", world.seed);
      url.searchParams.set("px", String(px));
      if (text) url.searchParams.set("lock", text); else url.searchParams.delete("lock");
      history.replaceState(null, "", url);
    } catch { /* (about:srcdoc: no URL to keep) */ }
  }

  function apply({ regenerate = false } = {}): void {
    const text = formatLocks(panelLocks());
    $("locks").value = text;
    remember(text);
    if (regenerate) { build(world.seed, text); return; }
    // (Live: clear what the panel writes, then write the panel again. Items need a regenerate.)
    const clear = (scope: string, key: string) => { world.unlock(scope, key); world.unset(scope, key, { force: true }); };
    for (const c of Object.values(CONTROLS)) clear(c.scope, c.key);
    for (const id of world.objects.keys()) { clear(`id:${id}`, "material"); clear(`id:${id}`, "show"); }
    const refused = world.applyLocks(text);
    $("warn").textContent = [...world.warnings, ...refused.map((r) => `refused: ${r.key} at ${r.layer} (locked at ${r.lockedAt})`)].join(" · ");
    explain();
  }

  function explain(): void {
    const lines: string[] = [];
    const show = (key: string, thing: string | null = null) => {
      const ex = world.explain(key, thing);
      const who = ex.locked ? `LOCKED at ${ex.lockedAt}` : `set by ${ex.layer ?? "nobody"}`;
      lines.push(`${thing ? `${thing} ` : ""}${key} = ${JSON.stringify(ex.value)}  ${who}${ex.rule ? `  (${ex.rule})` : ""}`);
      for (const c of ex.chain) lines.push(`    ${c.shadowed ? "x" : "·"} ${c.layer}: ${JSON.stringify(c.value)}${c.locked ? " (lock)" : ""}`);
    };
    show("render.palette"); show("render.dither.screen"); show("render.fx"); show("system.camera.mode"); show("system.particles.enabled");
    show("species", "hero");
    for (const e of world.entities.values()) if (e.tags.includes("animal")) show("species", e.id);
    const obj = $<HTMLSelectElement>("obj").value;
    if (obj) show("material", obj);
    $("explain").textContent = lines.join("\n");
  }

  // ---- the panel from the URL
  const lockText = q.get("lock") ?? "";
  for (const l of parseLocks(lockText)) {
    const hit = Object.entries(CONTROLS).find(([, c]) => c.scope === l.scope && c.key === l.key);
    const box = hit && host.querySelector<HTMLInputElement>(`[data-lock="${hit[0]}"]`);
    if (box) box.checked = l.lock;
    if (hit?.[0] === "fx") for (const b of boxes("[data-fx]")) b.checked = Array.isArray(l.value) && l.value.includes(b.dataset["fx"]!);
    else if (hit) $<HTMLSelectElement>(hit[0]).value = String(l.value);
    else if (l.scope.startsWith("id:") && (l.key === "material" || l.key === "show")) {
      const o = (objs[l.scope.slice(3)] ??= { material: null, lock: true, hidden: false });
      if (l.key === "material") { o.material = String(l.value); o.lock = l.lock; } else o.hidden = l.value === false;
    } else extra.push(l);
  }
  $("seed").value = String(token?.seed ?? q.get("seed") ?? page.KEEL_SEED ?? "1");
  $<HTMLSelectElement>("px").value = String(px);
  build($("seed").value, lockText);
  const first = Object.keys(objs)[0];
  if (first && world.objects.has(first)) { $<HTMLSelectElement>("obj").value = first; showObj(); }
  apply();

  for (const [name, c] of Object.entries(CONTROLS)) if (name !== "fx") $(name).addEventListener("change", () => apply({ regenerate: Boolean(c.item) }));
  for (const b of boxes("[data-fx]")) b.addEventListener("change", () => apply());
  for (const b of boxes("[data-lock]")) b.addEventListener("change", () => { if (b.dataset["lock"] === "mat") readObj(); apply({ regenerate: Boolean(CONTROLS[b.dataset["lock"]!]?.item) }); });
  $("mat").addEventListener("change", () => { readObj(); apply(); });
  $("show").addEventListener("change", () => { readObj(); apply(); });
  $("obj").addEventListener("change", () => { showObj(); explain(); });
  $("seed").addEventListener("change", () => { build($("seed").value, $("locks").value); apply(); });
  // (A new seed for the page: the UI's own dice, never the simulation's streams.)
  $("dice").addEventListener("click", () => { $("seed").value = String(1 + Math.floor(Math.random() * 99999)); build($("seed").value, $("locks").value); apply(); });
  // (Another size, live: the same world, the target rules follow.)
  $("px").addEventListener("change", () => { px = +$<HTMLSelectElement>("px").value; world.setTarget(px, px); remember($("locks").value); explain(); });
  // (Typed locks: the panel reads them, and the world is built again under them.)
  $("locks").addEventListener("change", () => {
    extra.length = 0;
    for (const l of parseLocks($("locks").value)) if (!Object.values(CONTROLS).some((c) => c.scope === l.scope && c.key === l.key)) extra.push(l);
    build(world.seed, $("locks").value);
    apply();
  });

  // ---- the loop: fixed steps for real time, then one frame
  let last = performance.now();
  let frames = 0;
  let fpsAt = last;
  let fps = 0;
  function hud(): void {
    const cam = world.camera;
    const showing = cam.mode === "frame" ? ` · showing ${(world.state["camera"] as { showing?: string } | undefined)?.showing} (its front)` : "";
    const hero = world.entities.get("hero");
    const state = (hero?.mind["state"] as string | undefined) ?? world.intent.driver;
    $("hud").textContent = `${cam.mode}${showing} · hero ${hero?.spec.species} ${state} · ${fps} fps · ${world.width}×${world.height}`;
  }
  function loop(now: number): void {
    requestAnimationFrame(loop);
    world.step((now - last) / 1000);
    last = now;
    world.draw(renderer);
    frames += 1;
    if (now - fpsAt > 500) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now; hud(); }
  }
  requestAnimationFrame(loop);
  world.draw(renderer);

  // (A still on request: whoever embeds the page -- a verification shell, a gallery -- may ask for the picture it already shows.)
  addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { protocol?: string; action?: string; advance?: number } | null;
    if (d?.protocol !== "keel-engine-still@1" || d.action !== "still") return;
    if (typeof d.advance === "number" && d.advance > 0) world.simulate(Math.min(d.advance, 30));
    world.draw(renderer);
    hud();
    (e.source as Window | null)?.postMessage({ protocol: "keel-engine-still@1", action: "still", png: canvas.toDataURL("image/png"), width: world.width, height: world.height }, { targetOrigin: "*" });
  });

  const api = { get world() { return world; } };
  page.GARDEN = api;
  return api;
}
