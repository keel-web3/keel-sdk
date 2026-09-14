import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveBundledFfmpeg } from "./media-optimization.js";

export interface ThumbnailSequence {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  /** Consecutive RGBA8 frames captured between explicit artwork markers. */
  readonly frames: readonly Uint8Array[];
}
/** Encode a bounded preview using the same hash-checked encoder as media optimization. */
export async function encodeThumbnailAvif(
  input: ThumbnailSequence,
): Promise<Uint8Array> {
  const { width, height, frameRate, frames } = input;
  if (
    ![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 256)
  )
    throw new RangeError("Motion previews must fit within 256 by 256 pixels.");
  if (!Number.isSafeInteger(frameRate) || frameRate < 1 || frameRate > 30)
    throw new RangeError("Preview frame rate must be from 1 through 30.");
  const size = width * height * 4;
  if (
    frames.length < 2 ||
    frames.length > 120 ||
    frames.length / frameRate > 30 ||
    frames.some((frame) => frame.byteLength !== size)
  )
    throw new RangeError(
      "A preview needs 2 through 120 complete RGBA frames and at most 30 seconds.",
    );
  const runtime = await resolveBundledFfmpeg();
  if (!runtime.available || !runtime.binary)
    throw new Error(
      runtime.reason ?? "The reviewed AVIF encoder is unavailable.",
    );
  const workspace = await mkdtemp(path.join(tmpdir(), "keel-thumbnail-"));
  try {
    await writeFile(path.join(workspace, "frames.rgba"), Buffer.concat(frames));
    await promisify(execFile)(
      runtime.binary,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        `${width}x${height}`,
        "-framerate",
        String(frameRate),
        "-i",
        "frames.rgba",
        "-map_metadata",
        "-1",
        "-an",
        "-c:v",
        "libaom-av1",
        "-cpu-used",
        "8",
        "-crf",
        "36",
        "-pix_fmt",
        "yuv444p",
        "-threads",
        "2",
        "-loop",
        "0",
        "-f",
        "avif",
        "-n",
        "preview.avif",
      ],
      { cwd: workspace, timeout: 60_000, maxBuffer: 64 * 1024 },
    );
    const output = await readFile(path.join(workspace, "preview.avif"));
    if (output.length === 0 || output.length > 2_097_152)
      throw new Error("Encoded preview exceeds the 2 MiB limit.");
    return new Uint8Array(output);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
