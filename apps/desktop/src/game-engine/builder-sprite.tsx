// The Builder's "as in game" pane: voxels are the authoring tool, what a game
// shows is the baked pixel-art sprite. While ops stream in (debounced), the
// build's first clip is posed by the builder worker and baked by the engine's
// baker in the preview frame -- eight directions at the sprite height a game
// draws it -- then shown animated at the game's pixel scale (its Game tab's
// pixel size, else the largest whole scale that fits).
import React, { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { api } from '../client';

type Preview = { ready: boolean; request: (message: Record<string, unknown>) => Promise<any> };
type Sheet = { url: string; w: number; h: number; frames: number; directions: number; ms: number; sprites: number };
export const SPRITE_HEIGHTS = [32, 48, 64, 96];
export const SPRITE_DIRECTIONS = 8;

/** Where sprite (direction, frame) sits on a baked sheet: a row per direction, a column per frame, 1 px gutters. */
export const spriteCell = (sheet: Pick<Sheet, 'w' | 'h'>, direction: number, frame: number) => ({ x: 1 + frame * (sheet.w + 2), y: 1 + direction * (sheet.h + 2), w: sheet.w, h: sheet.h });

export function SpritePane({ project, build, preview, drawn, delay = 650 }: { project: Project; build: string; preview: Preview; drawn: string; delay?: number }) {
  const [height, setHeight] = useState(48);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [note, setNote] = useState('');
  const [clip, setClip] = useState<{ name: string; period: number } | null>(null);
  const [turn, setTurn] = useState(0);
  const [baking, setBaking] = useState(false);
  const bakes = useRef(0);
  const main = useRef<HTMLCanvasElement>(null);
  const ring = useRef<HTMLCanvasElement>(null);
  // Bake after the build settles (a stream redraws many times a second; the bake waits for a pause).
  useEffect(() => {
    if (!preview.ready || !drawn) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const n = ++bakes.current;
      setBaking(true);
      try {
        const source = await api('gameBuilderPoses', { projectId: project.id, name: build });
        const result = await preview.request({ type: 'bake', source, sizes: [height], directions: SPRITE_DIRECTIONS });
        if (!alive || n !== bakes.current) return;
        const next = result.sheets[0] as Sheet;
        const img = new Image();
        img.onload = () => { if (alive && n === bakes.current) { setImage(img); setSheet(next); } };
        img.src = next.url;
        setClip({ name: source.clip, period: Number(source.info?.period ?? 1) || 1 });
        setNote('');
      } catch (error) { if (alive && n === bakes.current) { setNote((error as Error).message); setSheet(null); setImage(null); } }
      finally { if (alive && n === bakes.current) setBaking(false); }
    }, delay);
    return () => { alive = false; clearTimeout(timer); };
  }, [preview.ready, drawn, height, project.id, build]);
  // Play it: every direction's clip in step, the big one turned to `turn`.
  const scale = (w: number, h: number, box: number) => Math.max(1, project.game?.pixels ?? Math.floor(Math.min(box / w, box / h)));
  useEffect(() => {
    if (!sheet || !image) return;
    let frame = 0;
    const paint = () => {
      const f = frame % sheet.frames;
      const c = main.current, r = ring.current;
      if (c) {
        const k = scale(sheet.w, sheet.h, 240);
        c.width = sheet.w * k; c.height = sheet.h * k;
        const g = c.getContext('2d')!; g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height);
        const cell = spriteCell(sheet, turn % sheet.directions, f);
        g.drawImage(image, cell.x, cell.y, cell.w, cell.h, 0, 0, c.width, c.height);
      }
      if (r) {
        const k = Math.max(1, Math.floor(48 / sheet.h) || 1);
        r.width = sheet.directions * (sheet.w * k + 4); r.height = sheet.h * k;
        const g = r.getContext('2d')!; g.imageSmoothingEnabled = false; g.clearRect(0, 0, r.width, r.height);
        for (let d = 0; d < sheet.directions; d += 1) { const cell = spriteCell(sheet, d, f); g.drawImage(image, cell.x, cell.y, cell.w, cell.h, d * (sheet.w * k + 4), 0, sheet.w * k, sheet.h * k); }
      }
      frame += 1;
    };
    paint();
    const timer = setInterval(paint, Math.max(70, (clip?.period ?? 1) * 1000 / Math.max(1, sheet.frames)));
    return () => clearInterval(timer);
  }, [sheet, image, turn, clip, project.game?.pixels]);
  return <section className="sprite-pane" aria-label="As in game">
    <div className="pane-title">AS IN GAME <span className="sprite-badge">{sheet ? `${height} px · ${sheet.directions} directions · ${sheet.frames} frames` : 'baked pixel sprite'}</span></div>
    <div className="sprite-stage">{sheet ? <canvas ref={main} aria-label="Baked sprite" data-frames={sheet.frames} data-directions={sheet.directions} data-w={sheet.w} data-h={sheet.h} /> : <p className="builder-hint">{note || (baking ? 'Baking…' : 'Draw something: its baked sprite shows here.')}</p>}</div>
    {sheet && <canvas className="sprite-ring" ref={ring} aria-label="Eight directions" onClick={(event) => { const r = event.currentTarget.getBoundingClientRect(); setTurn(Math.min(sheet.directions - 1, Math.floor((event.clientX - r.left) / r.width * sheet.directions))); }} />}
    <div className="sprite-actions">
      <button aria-label="Turn left" onClick={() => setTurn((value) => (value + SPRITE_DIRECTIONS - 1) % SPRITE_DIRECTIONS)}>⟲</button>
      <span>direction {turn + 1}/{SPRITE_DIRECTIONS}</span>
      <button aria-label="Turn right" onClick={() => setTurn((value) => (value + 1) % SPRITE_DIRECTIONS)}>⟳</button>
      <select aria-label="Sprite height" value={height} onChange={(event) => setHeight(Number(event.target.value))}>{SPRITE_HEIGHTS.map((item) => <option key={item} value={item}>{item} px tall</option>)}</select>
    </div>
    <p className="builder-hint">{note && sheet ? note : `The engine's baker: ${clip ? `clip ${clip.name}, ` : ''}palette, dither and outline as a game draws it${project.game?.pixels ? `, at the game's pixel size ×${project.game.pixels}` : ''}. Voxels are how you build it; this is what players see.${baking && sheet ? ' Re-baking…' : ''}`}</p>
  </section>;
}
