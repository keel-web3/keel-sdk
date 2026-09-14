"""Prepare only original-token layers at 1080; leave source artwork untouched."""
from pathlib import Path
from PIL import Image
import hashlib
import json

root = Path('apps/desktop/artifacts/gator-raster-study')
out = root / 'full-1080'
(out / 'rgba').mkdir(parents=True, exist_ok=True)
(out / 'png').mkdir(exist_ok=True)
data = json.loads((root / 'input.json').read_text())
rows = {row['path']: row for row in data['rows']}
used = {path for token in data['tokens'] for path in token['paths']}
sources = {rows[path]['objectId']: rows[path] for path in sorted(used)}
layers, by_source, by_pixels = [], {}, {}
for i, (source, row) in enumerate(sources.items()):
    cached = root / 'adaptive-1080' / 'assets' / f'{source}.png'
    if cached.exists():
        with Image.open(cached) as image:
            image = image.convert('RGBA')
    else:
        with Image.open(Path('apps/desktop/artifacts/gator-recovery/png-2160') / row['file']) as original:
            image = original.convert('RGBA').resize((1080, 1080), Image.Resampling.LANCZOS)
    pixels = image.tobytes()
    digest = hashlib.sha256(pixels).hexdigest()
    if digest not in by_pixels:
        index = len(layers)
        by_pixels[digest] = index
        raw_path = out / 'rgba' / f'{digest}.rgba'
        png_path = out / 'png' / f'{digest}.png'
        if not raw_path.exists():
            raw_path.write_bytes(pixels)
        if not png_path.exists():
            image.save(png_path, compress_level=6)
        layers.append({'rgba': str(raw_path), 'pixelHash': digest, 'pngBytes': png_path.stat().st_size})
    by_source[source] = by_pixels[digest]
    if (i + 1) % 64 == 0:
        print(json.dumps({'phase': 'original layers', 'done': i + 1, 'total': len(sources)}), flush=True)
tokens = [{'id': token['id'], 'layers': [by_source[rows[path]['objectId']] for path in token['paths']]} for token in data['tokens']]
manifest = {'size': 1080, 'tokens': tokens, 'layers': layers, 'usedLogicalPaths': len(used), 'uniqueOriginalSourceImages': len(sources), 'uniqueResizedPixelImages': len(layers), 'sourcePNGBytes': sum(layer['pngBytes'] for layer in layers)}
(out / 'input.json').write_text(json.dumps(manifest))
print(json.dumps({key: value for key, value in manifest.items() if key not in ('tokens', 'layers')}), flush=True)
