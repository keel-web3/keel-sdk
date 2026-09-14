"""Compatibility entry point: prepare lossless PNG copies; originals stay untouched."""
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[3]
subprocess.run(["node", str(Path(__file__).with_name("prepare-gator-pngs.mjs")), *sys.argv[1:]], cwd=root, check=True)
