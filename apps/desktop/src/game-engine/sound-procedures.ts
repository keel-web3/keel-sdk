// The Sound tab's operations, spread into main's tRPC router next to the game
// engine's and the builder's. The renderer never imports engine code: it sends
// recipes, sound ops and settings, and reads JSON (plans, summaries, sizes, the
// doc) over IPC. A rendered loop comes back from the audition page as WAV bytes
// and is saved through the same save dialog the editor's other exports use.
import { z } from 'zod';
import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { soundOpsInput } from './sound-project.mjs';
import type { GameSoundService } from './sound-service.mjs';

const projectId = z.string().uuid();
const recipe = z.record(z.string(), z.unknown());
const b64url = z.string().max(4_000_000).regex(/^[A-Za-z0-9_-]+$/);
/** Largest loop the editor saves (a 40-bar loop at 64 bpm, stereo, 48 kHz, is ~29 MB). */
export const MAX_WAV_BYTES = 64 * 1024 * 1024;

/** A WAV's bytes as the audition page made them: RIFF/WAVE, 16-bit PCM. */
export function checkWav(bytes: Uint8Array) {
  const text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.byteLength < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || text(12, 4) !== 'fmt ') throw Error('That is not a WAV file.');
  if (bytes.byteLength > MAX_WAV_BYTES) throw Error(`The loop is ${Math.round(bytes.byteLength / 1048576)} MB; the editor saves loops up to ${MAX_WAV_BYTES / 1048576} MB. Render at a lower rate.`);
  return bytes;
}

// (main.ts owns the tRPC instance; these only need its procedure builder.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function soundProcedures(t: { procedure: any }, sound: () => GameSoundService) {
  return {
    gameSoundCatalogue: t.procedure.query(() => sound().catalogue()),
    gameSoundMusic: t.procedure.input(z.object({ recipe: recipe.optional(), bytes: b64url.optional(), store: z.enum(['recipe', 'song']).default('recipe') }).strict().refine((v: { recipe?: unknown; bytes?: string }) => !!v.recipe !== !!v.bytes, 'A recipe or bytes.')).query(({ input }: { input: { recipe?: Record<string, unknown>; bytes?: string; store: 'recipe' | 'song' } }) => sound().music(input)),
    gameSoundVariations: t.procedure.input(z.object({ recipe, count: z.number().int().min(1).max(12).default(6) }).strict()).query(({ input }: { input: { recipe: Record<string, unknown>; count: number } }) => sound().variations(input.recipe, input.count)),
    gameSoundSfx: t.procedure.input(z.object({ settings: recipe }).strict()).query(({ input }: { input: { settings: Record<string, unknown> } }) => sound().sfx(input.settings)),
    gameSoundOpen: t.procedure.input(z.object({ projectId, content: z.string().max(8_000_000) }).strict()).mutation(({ input }: { input: { projectId: string; content: string } }) => sound().open(input.projectId, input.content, { editor: true })),
    gameSoundApply: t.procedure.input(z.object({ projectId, ops: soundOpsInput }).strict()).mutation(({ input }: { input: { projectId: string; ops: { op: string }[] } }) => sound().apply(input.projectId, input.ops)),
    gameSoundDoc: t.procedure.input(z.object({ projectId, after: z.number().int().min(0) }).strict()).query(({ input }: { input: { projectId: string; after: number } }) => sound().wait(input.projectId, input.after)),
    gameSoundDescribe: t.procedure.input(z.object({ projectId }).strict()).query(({ input }: { input: { projectId: string } }) => { const live = sound().live(input.projectId); return sound().describe(live?.doc ?? { music: [], assign: [], sfx: null }); }),
    gameSoundSaved: t.procedure.input(z.object({ projectId, content: z.string().max(8_000_000) }).strict()).mutation(({ input }: { input: { projectId: string; content: string } }) => sound().saved(input.projectId, input.content)),
    gameSoundClose: t.procedure.input(z.object({ projectId }).strict()).mutation(({ input }: { input: { projectId: string } }) => sound().closeDoc(input.projectId)),
    gameSoundReport: t.procedure.input(z.object({ id: z.number().int().positive(), report: z.record(z.string(), z.unknown()) }).strict()).mutation(({ input }: { input: { id: number; report: Record<string, unknown> } }) => sound().report(input.id, input.report)),
    /** A rendered loop, saved where the creator chooses (the editor's save dialog, as every export). */
    gameSoundSaveWav: t.procedure.input(z.object({ name: z.string().max(120), bytes: z.instanceof(Uint8Array) }).strict()).mutation(async ({ input }: { input: { name: string; bytes: Uint8Array } }) => {
      const bytes = checkWav(input.bytes);
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = { title: 'Save music loop', defaultPath: `${input.name.replace(/[^a-zA-Z0-9 _-]/g, '_') || 'loop'}.wav`, filters: [{ name: 'WAV audio', extensions: ['wav'] }] };
      const selected = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (selected.canceled || !selected.filePath) return null;
      await writeFile(selected.filePath, bytes);
      return { saved: true, bytes: bytes.byteLength, file: selected.filePath.split(/[\\/]/).pop() };
    }),
  };
}
