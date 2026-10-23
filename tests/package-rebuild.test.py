import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("package_rebuild", Path(__file__).resolve().parents[1] / "scripts/verify-package-rebuild.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageRebuildTests(unittest.TestCase):
    def pack(self, root, metadata, runtime=b"export const current = true;", extra=None):
        Path(root).mkdir(exist_ok=True)
        with tarfile.open(Path(root) / "keel-sdk.tgz", "w:gz") as archive:
            files = {"package/package.json": json.dumps(metadata).encode(), "package/dist/index.js": runtime}
            if extra:
                files.update(extra)
            for name, data in files.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                entry.mode = 0o644
                archive.addfile(entry, io.BytesIO(data))

    def test_dependency_order_is_harmless_but_version_changes_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            a, b = Path(root) / "a", Path(root) / "b"
            self.pack(a, {"dependencies": {"@keel/protocol": "0.3.0", "@keel/viewer": "0.3.0"}})
            self.pack(b, {"dependencies": {"@keel/viewer": "0.3.0", "@keel/protocol": "0.3.0"}})
            module.compare_packages(a, b)
            self.pack(b, {"dependencies": {"@keel/viewer": "0.4.0", "@keel/protocol": "0.3.0"}})
            with self.assertRaisesRegex(ValueError, "package/package.json"):
                module.compare_packages(a, b)

    def test_runtime_changes_and_obsolete_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            a, b = Path(root) / "a", Path(root) / "b"
            self.pack(a, {"name": "@keel/sdk"})
            self.pack(b, {"name": "@keel/sdk"}, runtime=b"export const wrong = true;")
            with self.assertRaisesRegex(ValueError, "package/dist/index.js"):
                module.compare_packages(a, b)
            self.pack(b, {"name": "@keel/sdk"}, extra={"package/dist/proof-runtime/runner-client.js": b"stale"})
            with self.assertRaisesRegex(ValueError, "runner-client.js"):
                module.compare_packages(a, b)


if __name__ == "__main__":
    unittest.main()
