// UI DEMO: the engine's generative UI in a dozen lines. One call makes a
// whole HUD for a seed and a culture (an RTS race's flavour); the UI draws it
// into its own pixel layer, a canvas above the game, and redraws only what
// changes. KEEL_SEED picks the seed; ?culture= (industrial, organic,
// crystalline, arcane, brutal, clean -- or Machine, Biotic...) the culture.

import { createCanvasPresenter, createUi, generateHud, uiScaleFor } from "@keel/game-engine/ui";

export function main(host: HTMLElement): void {
  const seed = String((globalThis as { KEEL_SEED?: unknown }).KEEL_SEED ?? 7);
  const culture = new URLSearchParams(location.search).get("culture") ?? "industrial";
  host.style.cssText = "margin:0;height:100vh;background:#2c3a26;overflow:hidden";
  const dpr = devicePixelRatio || 1;
  const W = Math.floor(innerWidth * dpr), H = Math.floor(innerHeight * dpr);

  const scale = uiScaleFor(W, H);                                   // a whole UI scale for this screen
  const hud = generateHud({ seed, culture, width: Math.ceil(W / scale), height: Math.ceil(H / scale) }); // the theme and the layout
  const ui = createUi({ theme: hud.theme, width: W, height: H, scale });
  ui.load(hud.screen);

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;left:0;top:0";
  host.append(canvas);
  const screen = createCanvasPresenter(canvas as never, ui, dpr);
  canvas.addEventListener("pointermove", (e) => ui.pointerMove(e.offsetX * dpr, e.offsetY * dpr));
  canvas.addEventListener("pointerdown", (e) => ui.pointerDown(e.offsetX * dpr, e.offsetY * dpr));
  canvas.addEventListener("pointerup", (e) => ui.pointerUp(e.offsetX * dpr, e.offsetY * dpr));
  addEventListener("keydown", (e) => { if (ui.key(e.code, true, { shift: e.shiftKey })) e.preventDefault(); });
  addEventListener("keyup", (e) => ui.key(e.code, false));
  ui.on("click", (id) => ui.toast(`{accent}${id}{/}`, { seconds: 1.5 }));

  let t = 0, last = performance.now();
  const frame = (now: number) => {
    const dt = (now - last) / 1000; last = now; t += dt;
    ui.set("res.mass", { text: `{icon:mass} {tab}${350 + Math.floor(t * 5)}{/}` });
    ui.set("cmd.0.4", { cooldown: (t * 0.3) % 1 });
    ui.set("unit.hp", { value: 30 + 18 * Math.sin(t), text: `${Math.round(30 + 18 * Math.sin(t))}/50` });
    ui.update(dt);
    screen.present(ui.render());                                    // nothing changed: nothing to do
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
