"""Actual snapshot helper, private temporary files, no Docker/host calls."""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(os.environ.get("REVIEW_ACTIVATION_OPERATOR", "/Users/ravonus/dev/wt/studio-publication-20261019/release-proof-qualification/docs/reviews/studio-publication-20261019/release/final-candidate/activation-fe944/activate-qualified-studio.py"))
spec = importlib.util.spec_from_file_location("actual_review_activation", SOURCE)
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class SnapshotFailureDurability(unittest.TestCase):
    def test_timeout_keeps_partial_snapshot_content_and_path_durable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            syncs = []
            real_sync = os.fsync

            def tracked_sync(fd):
                syncs.append("directory" if stat.S_ISDIR(os.fstat(fd).st_mode) else "file")
                return real_sync(fd)

            def timeout_after_partial_output(command, stdout, stderr, timeout):
                stdout.write(b"PGDMP-partial-review")
                raise subprocess.TimeoutExpired(command, timeout)

            with patch.object(a.os, "fsync", tracked_sync), patch.object(a.subprocess, "run", timeout_after_partial_output):
                with self.assertRaises(subprocess.TimeoutExpired):
                    a.retain_database_snapshot(root, "a" * 64, 1024)
            self.assertEqual((root / "retained-database-before.dump").read_bytes(), b"PGDMP-partial-review")
            print({"partialBytes": len(b"PGDMP-partial-review"), "syncs": syncs, "actualDockerCalls": 0})
            self.assertIn("file", syncs, "Timeout failure must fsync retained partial evidence before returning")
            self.assertIn("directory", syncs, "Timeout failure must durably retain the new partial snapshot pathname")


if __name__ == "__main__":
    unittest.main()
