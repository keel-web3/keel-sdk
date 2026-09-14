"""Per-layer codec comparison; originals remain unchanged and nothing is published."""
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

root = Path('apps/desktop/artifacts/gator-ape-rebuild')
dimension = int(os.environ.get('KEEL_GATOR_SIZE', '4525'))
output = root / ('mixed-codec-test' if dimension == 4525 else f'mixed-codec-test-{dimension}')
output.mkdir(exist_ok=True)
rows = json.loads((root / 'webp-token-0.json').read_text())
baseline_search = json.loads((root / 'webp-lossless-search/report.json').read_text())
lossless = {row['path']: row['best'] for row in baseline_search['layers']}


def ssim(reference, candidate):
    run = subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-threads', '1',
                          '-i', str(reference), '-threads', '1', '-i', str(candidate),
                          '-filter_complex_threads', '1', '-filter_complex',
                          '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim',
                          '-frames:v', '1', '-f', 'null', '-'], capture_output=True, check=True, text=True)
    scores = re.findall(r'All:([0-9.]+)', run.stderr)
    if not scores:
        raise RuntimeError('SSIM did not return a score: ' + run.stderr[-1000:])
    return float(scores[-1])


def matte(image, colour, bounds):
    rgb = Image.new('RGB', image.size, (colour,) * 3)
    rgb.paste(image, mask=image.getchannel('A'))
    return rgb.crop(bounds)


def compare(row):
    folder = output / row['objectId']
    folder.mkdir(exist_ok=True)
    source = Image.open(row['file']).convert('RGBA')
    if source.size != (dimension, dimension):
        source = source.resize((dimension, dimension), Image.Resampling.LANCZOS)
    profile = Image.open(row['file']).info.get('icc_profile')
    prior = lossless[row['path']]
    if dimension != 4525:
        resized_png = folder / 'resized-source.png'
        source.save(resized_png, compress_level=1, **({'icc_profile': profile} if profile else {}))
        resized_lossless = folder / 'resized-lossless.webp'
        subprocess.run(['/opt/homebrew/bin/cwebp', '-quiet', '-lossless', '-q', '100', '-m', '6',
                        '-metadata', 'icc', str(resized_png), '-o', str(resized_lossless)], check=True)
        restored = np.asarray(Image.open(resized_lossless).convert('RGBA'))
        expected = np.asarray(source)
        assert np.array_equal(restored[:, :, 3], expected[:, :, 3]), 'Lossless alpha mismatch'
        assert np.array_equal(restored[expected[:, :, 3] > 0], expected[expected[:, :, 3] > 0]), 'Lossless visible pixel mismatch'
        prior = {'file': str(resized_lossless.resolve()), 'bytes': resized_lossless.stat().st_size,
                 'sha256': hashlib.sha256(resized_lossless.read_bytes()).hexdigest()}
    alpha = np.asarray(source.getchannel('A'))
    bounds = source.getchannel('A').getbbox()
    if not bounds:
        best = {'file': prior['file'], 'type': 'image/webp', 'quality': 'lossless',
                'bytes': prior['bytes'], 'ssimBlack': 1.0, 'ssimWhite': 1.0,
                'alphaChanges': 0, 'objectId': prior['sha256']}
        result = {'path': row['path'], 'sourcePath': row['sourcePath'], 'sourceDigest': row['sourceDigest'],
                  'width': source.width, 'height': source.height, 'best': best,
                  'candidates': [best], 'fullyTransparent': True}
        (folder / 'report.json').write_text(json.dumps(result, indent=2))
        return result
    for colour in [0, 255]:
        matte(source, colour, bounds).save(folder / f'reference-{colour}.png', compress_level=1)
    # Native encoders receive the exact same RGBA source. AVIF preserves 4:4:4
    # colour and lossless alpha; ICC is explicitly retained in the source PNG.
    source_png = folder / 'source.png'
    source.save(source_png, compress_level=1, **({'icc_profile': profile} if profile else {}))
    candidates = [{'file': prior['file'], 'type': 'image/webp', 'quality': 'lossless',
                   'bytes': prior['bytes'], 'ssimBlack': 1.0, 'ssimWhite': 1.0,
                   'alphaChanges': 0, 'objectId': prior['sha256']}]
    report_path = folder / 'report.json'
    if report_path.exists():
        cached = json.loads(report_path.read_text())
        for item in cached['candidates'][1:]:
            file = Path(item['file'])
            if file.exists() and hashlib.sha256(file.read_bytes()).hexdigest() == item['objectId']:
                candidates.append(item)
    for codec, quality in [('webp', 90), ('webp', 80), ('avif', 80), ('avif', 65), ('avif', 50), ('avif', 85), ('avif', 90), ('avif', 95)]:
        if any(item['type'] == 'image/' + codec and item['quality'] == quality for item in candidates):
            continue
        if codec == 'avif' and quality > 80 and any(item['type'] == 'image/avif' and min(item['ssimBlack'], item['ssimWhite']) >= 0.99 for item in candidates):
            continue
        file = folder / f'{codec}-{quality}.{codec}'
        if codec == 'webp':
            command = ['/opt/homebrew/bin/cwebp', '-quiet', '-q', str(quality), '-m', '6',
                       '-alpha_q', '100', '-alpha_filter', 'best', '-sharp_yuv',
                       '-metadata', 'icc', str(source_png), '-o', str(file)]
        else:
            command = ['/opt/homebrew/bin/avifenc', '-q', str(quality), '--qalpha', '100',
                       '-y', '444', '-d', '8', '-s', '6', '-j', '2',
                       '--ignore-exif', '--ignore-xmp', str(source_png), str(file)]
        subprocess.run(command, check=True, capture_output=True)
        restored_file = Image.open(file)
        assert restored_file.info.get('icc_profile') == profile, 'ICC changed'
        restored = restored_file.convert('RGBA')
        assert restored.size == source.size, 'Resolution changed'
        alpha_changes = int(np.count_nonzero(np.asarray(restored.getchannel('A')) != alpha))
        assert alpha_changes == 0, 'Transparency changed'
        metrics = []
        for colour in [0, 255]:
            temporary = folder / f'candidate-{colour}.png'
            matte(restored, colour, bounds).save(temporary, compress_level=1)
            metrics.append(ssim(folder / f'reference-{colour}.png', temporary))
            temporary.unlink()
        candidate = {'file': str(file.resolve()), 'type': 'image/' + codec, 'quality': quality,
                     'bytes': file.stat().st_size, 'ssimBlack': metrics[0], 'ssimWhite': metrics[1],
                     'alphaChanges': alpha_changes, 'objectId': hashlib.sha256(file.read_bytes()).hexdigest()}
        candidates.append(candidate)
        print(json.dumps({'path': row['path'], **{k: candidate[k] for k in ['type', 'quality', 'bytes', 'ssimBlack', 'ssimWhite']}}), flush=True)
    accepted = [item for item in candidates if min(item['ssimBlack'], item['ssimWhite']) >= 0.99]
    best = min(accepted, key=lambda item: item['bytes'])
    result = {'path': row['path'], 'sourcePath': row['sourcePath'], 'sourceDigest': row['sourceDigest'],
              'width': source.width, 'height': source.height, 'best': best, 'candidates': candidates}
    (folder / 'report.json').write_text(json.dumps(result, indent=2))
    for temporary in [source_png, folder / 'reference-0.png', folder / 'reference-255.png']:
        temporary.unlink()
    return result


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(compare, rows))
    selected = [{**row['best'], 'path': row['path'], 'width': row['width'], 'height': row['height'],
                 'sourcePath': row['sourcePath'], 'sourceDigest': row['sourceDigest']} for row in results]
    report = {'layers': results, 'selectedBytes': sum(row['bytes'] for row in selected),
              'perLayerThreshold': 0.99, 'metric': 'FFmpeg RGB SSIM over alpha bounding box, worst of black and white matte',
              'resolution': [dimension, dimension], 'originalsChanged': False, 'published': False,
              'finalCompositionValidated': False, 'completeInlineBytes': None,
              'completeInlineTargetBytes': 1_000_000, 'completeInlineMaximumBytes': 1_750_000}
    (output / 'report.json').write_text(json.dumps(report, indent=2))
    (output / 'selected.json').write_text(json.dumps(selected, indent=2))
    print(json.dumps({key: value for key, value in report.items() if key != 'layers'}), flush=True)
