"""Compare actual packed files; pnpm may reorder workspace dependency JSON keys."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile


def package_manifest(archive):
    files = {}
    with tarfile.open(archive, "r:gz") as package:
        for member in package:
            if member.isdir():
                continue
            if not member.isfile() or member.name in files:
                raise ValueError(f"Unexpected or duplicate package entry: {member.name}")
            data = package.extractfile(member).read()
            if member.name == "package/package.json":
                data = json.dumps(json.loads(data), sort_keys=True, separators=(",", ":")).encode()
            files[member.name] = (member.mode, hashlib.sha256(data).hexdigest())
    return files


def compare_packages(first, second):
    left = {p.name: p for p in Path(first).glob("*.tgz")}
    right = {p.name: p for p in Path(second).glob("*.tgz")}
    if not left or left.keys() != right.keys():
        raise ValueError("Package inventory changed or empty")
    for name in sorted(left):
        a, b = package_manifest(left[name]), package_manifest(right[name])
        if a != b:
            changed = sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k))
            raise ValueError(f"Rebuild changed {name}: {', '.join(changed)}")
        if "package/dist/proof-runtime/runner-client.js" in b:
            raise ValueError("Obsolete injected module survived rebuild")
        print(name, len(a), "package files identical (package.json key order normalized)")


if __name__ == "__main__":
    compare_packages(*sys.argv[1:])
