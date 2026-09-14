"""Compare encoder effort settings; preserve every visible channel and alpha value.

This diagnostic writes candidates only. It does not replace editor assets or publish.
Lossless -q controls compression effort, not visual quality. No near-lossless mode.
"""
import concurrent.futures
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

root = Path('apps/desktop/artifacts/gator-ape-rebuild')
rows = json.loads((root / 'webp-token-0.json').read_text())
output = root / 'webp-lossless-search'
output.mkdir(exist_ok=True)
settings = [(25, 6), (50, 6), (75, 6), (100, 4), (100, 5)]


def search(row):
    folder = output / row['objectId']
    folder.mkdir(exist_ok=True)
    with Image.open(row['file']) as image:
        original = np.asarray(image.convert('RGBA'))
        profile = image.info.get('icc_profile')
    visible = original[:, :, 3] > 0

    def verify(file, setting):
        with Image.open(file) as image:
            decoded = np.asarray(image.convert('RGBA'))
            assert image.info.get('icc_profile') == profile, 'ICC mismatch'
        assert original.shape == decoded.shape, 'Dimensions mismatch'
        alpha_changes = int(np.count_nonzero(original[:, :, 3] != decoded[:, :, 3]))
        visible_changes = int(np.count_nonzero(original[visible] != decoded[visible]))
        assert alpha_changes == visible_changes == 0, 'Visible channel mismatch'
        return {'file': str(file.resolve()), 'bytes': file.stat().st_size,
                'setting': setting, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                'alphaChanges': alpha_changes, 'visibleChannelChanges': visible_changes,
                'hiddenRGBChanges': int(np.count_nonzero(original[~visible, :3] != decoded[~visible, :3]))}

    candidates = [verify(Path(row['file']), 'original-exact-q100-m6')]
    optimized = root / 'webp-audit' / (row['objectId'] + '.webp')
    if optimized.exists():
        candidates.append(verify(optimized, 'transparent-rgb-optimized-q100-m6'))
    for quality, method in settings:
        file = folder / f'q{quality}-m{method}.webp'
        subprocess.run(['/opt/homebrew/bin/cwebp', '-quiet', '-lossless',
                        '-q', str(quality), '-m', str(method), '-metadata', 'icc',
                        row['file'], '-o', str(file)], check=True)
        candidate = verify(file, f'transparent-rgb-optimized-q{quality}-m{method}')
        candidates.append(candidate)
    best = min(candidates, key=lambda candidate: candidate['bytes'])
    result = {'path': row['path'], 'originalBytes': Path(row['file']).stat().st_size,
              'width': original.shape[1], 'height': original.shape[0],
              'best': best, 'candidates': candidates}
    (folder / 'report.json').write_text(json.dumps(result, indent=2))
    print(json.dumps({'path': row['path'], 'originalBytes': result['originalBytes'],
                      'bestBytes': best['bytes'], 'setting': best['setting']}), flush=True)
    return result


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(search, rows))
report = {'layers': results, 'originalBytes': sum(row['originalBytes'] for row in results),
          'bestBytes': sum(row['best']['bytes'] for row in results),
          'resized': False, 'originalsChanged': False, 'published': False,
          'proof': 'Zero changed alpha values and RGB channels where alpha > 0; identical ICC and dimensions. Browser composition validation remains separate.'}
(output / 'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps({key: value for key, value in report.items() if key != 'layers'}), flush=True)
