#!/usr/bin/env python3
"""Encode the compact animated resource used by the KEEL GIF reconstruction path."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image


def write_new(path: Path, data: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--quality", type=int, default=45)
    parser.add_argument("--speed", type=int, default=6)
    args = parser.parse_args()
    if not 1 <= args.quality <= 100:
        parser.error("--quality must be between 1 and 100")
    if not 0 <= args.speed <= 10:
        parser.error("--speed must be between 0 and 10")
    source = args.input.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if not source.is_file():
        parser.error(f"--input is not a file: {source}")

    source_output = output_dir / "source.gif"
    media_output = output_dir / "animation.avif"
    palette_output = output_dir / "palette.bin"
    metadata_output = output_dir / "source-metadata.json"
    targets = [source_output, media_output, palette_output, metadata_output]
    existing = [str(path) for path in targets if path.exists()]
    if existing:
        parser.error(f"refusing to overwrite existing output: {', '.join(existing)}")

    image = Image.open(source)
    frames = []
    durations = []
    palette = image._frame_palette or image.global_palette or image.palette
    if palette is None:
        parser.error("the source animation has no indexed palette")
    palette_bytes = bytes(palette.palette)
    for index in range(image.n_frames):
        image.seek(index)
        frames.append(image.convert("RGB"))
        durations.append(int(image.info.get("duration", 30)))
    if len(palette_bytes) < 254 * 3:
        parser.error("the source palette has fewer than 254 RGB entries")

    shutil.copyfile(source, source_output)
    frames[0].save(
        media_output,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=int(image.info.get("loop", 0)),
        quality=args.quality,
        speed=args.speed,
        subsampling="4:4:4",
        max_threads=3,
    )
    write_new(palette_output, palette_bytes[: 254 * 3])
    write_new(
        metadata_output,
        (
            json.dumps(
                {
                    "width": image.width,
                    "height": image.height,
                    "frames": len(frames),
                    "durations": durations,
                    "durationMs": sum(durations),
                    "loop": int(image.info.get("loop", 0)),
                    "sourceBytes": source.stat().st_size,
                    "encoder": {"format": "avif", "quality": args.quality, "speed": args.speed, "subsampling": "4:4:4"},
                },
                separators=(",", ":"),
            )
            + "\n"
        ).encode("utf-8"),
    )
    print(json.dumps({"source": str(source_output), "media": str(media_output), "palette": str(palette_output), "metadata": str(metadata_output)}))


if __name__ == "__main__":
    main()
