#!/usr/bin/env python3
"""Reproduce the pinned native engine offline from explicit public build inputs.
No source/toolchain/dependency downloads, network RPC, signing, or submission.
"""
import argparse, hashlib, json, os
from pathlib import Path
import shutil, subprocess, tarfile

ROOT = Path(__file__).resolve().parent

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def verified(path, expected_sha, expected_bytes=None):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Explicit regular file required: ' + str(path))
    if expected_bytes is not None and path.stat().st_size != expected_bytes:
        raise ValueError('Byte count differs: ' + str(path))
    if digest(path) != expected_sha:
        raise ValueError('SHA256 differs: ' + str(path))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('geth-archive', 'go-archive', 'output', 'module-cache', 'build-cache'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--public-proof-fixture', type=Path)
    args = parser.parse_args()
    for path in vars(args).values():
        if path is not None and not path.is_absolute():
            raise ValueError('All paths must be absolute')
    manifest = json.loads((ROOT / 'source-manifest.json').read_text())
    for item in manifest['sourceFiles']:
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid source manifest path')
        verified(ROOT / relative, item['sha256'], item['bytes'])
    verified(args.geth_archive, manifest['upstream']['archiveSHA256'], manifest['upstream']['archiveBytes'])
    verified(args.go_archive, manifest['toolchain']['archiveSHA256'], manifest['toolchain']['archiveBytes'])
    if not args.module_cache.is_dir():
        raise ValueError('Supply the already checksum-verified Go module cache')
    args.output.mkdir(mode=0o700, exist_ok=False)
    for archive in (args.geth_archive, args.go_archive):
        with tarfile.open(archive) as content:
            content.extractall(args.output, filter='data')
    source = args.output / ('go-ethereum-' + manifest['upstream']['commit'])
    go = args.output / 'go/bin/go'
    verified(go, manifest['toolchain']['compilerSHA256'])
    environment = dict(os.environ)
    for name in ('GOFLAGS', 'GOWORK', 'KEEL_PUBLIC_FACTORY_PROOF_FIXTURE', 'KEEL_SYNTHETIC_FIXTURE_OUTPUT', 'KEEL_SYNTHETIC_RUNTIME', 'KEEL_SYNTHETIC_PROGRAM', 'KEEL_SYNTHETIC_DELEGATE_RUNTIME'):
        environment.pop(name, None)
    environment.update(GOTOOLCHAIN='local', GOPROXY='off', CGO_ENABLED='0', GOMAXPROCS='4',
        GOMODCACHE=str(args.module_cache), GOCACHE=str(args.build_cache), GOPATH=str(args.output / 'gopath'))
    if args.public_proof_fixture:
        environment['KEEL_PUBLIC_FACTORY_PROOF_FIXTURE'] = str(args.public_proof_fixture)
    subprocess.run(['patch', '--batch', '--forward', '-p1', '-i', str(ROOT / 'simulate.patch')], cwd=source, check=True)
    for path in (ROOT / 'overlay').rglob('*'):
        if path.is_file():
            target = source / path.relative_to(ROOT / 'overlay')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    commands = [
        [str(go), 'version'],
        [str(go), 'mod', 'verify'],
        [str(go), 'test', '-count=1', '-v', '-run', '^(TestKeelSparse|TestKeelSessionProtocol|TestSimulate)', './internal/ethapi'],
        [str(go), 'build', '-mod=readonly', '-buildvcs=false', '-trimpath', '-o', str(args.output / 'keel-sparse'), './cmd/keel-sparse'],
    ]
    for index, command in enumerate(commands):
        with (args.output / f'build-{index}.log').open('xb') as log:
            subprocess.run(command, cwd=source, env=environment, stdout=log, stderr=subprocess.STDOUT, check=True)
    receipt = dict(schema='keel-canonical-native-engine-build@1', upstream=manifest['upstream'], toolchain=manifest['toolchain'],
        sourceManifestSHA256=digest(ROOT / 'source-manifest.json'), binarySHA256=digest(args.output / 'keel-sparse'),
        binaryBytes=(args.output / 'keel-sparse').stat().st_size, commands=commands,
        publicProofFixtureSupplied=bool(args.public_proof_fixture), projectAcceptance=False,
        scope='Offline cloud build and native mechanism tests. No complete real-project witness or publication acceptance.')
    (args.output / 'build-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))

if __name__ == '__main__':
    main()
