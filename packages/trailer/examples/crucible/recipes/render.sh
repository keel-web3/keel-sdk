#!/bin/sh
# Re-render the CRUCIBLE.EXE launch trailer from scratch (captures, then the edit).
#   sh render.sh CAPTURES_DIR [MUSIC_FILE]
# CAPTURES_DIR holds the intermediate captures (large: keep it out of the repo, e.g. a scratch directory).
# MUSIC_FILE is the one swappable input: any track ffmpeg reads; the beat grid and every cut follow it.
# Default music: bed-128.wav, a trailer-only bed played on the ROM's own sound hardware (make_bed.py).
# Steps can be skipped by setting SKIP_GAME=1, SKIP_SITE=1 or SKIP_MUSIC=1 when their captures are current.
# Machine load: check `uptime` first; site capture (SwiftShader WebGL) and the renders are CPU-heavy.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
CAP=${1:?captures dir}; MUSIC=${2:-}
PY=${PYBOY_PYTHON:-python3}          # a python with pyboy 2.7, numpy, pillow
mkdir -p "$CAP"
[ -n "$SKIP_GAME" ]  || "$PY" "$HERE/capture_game.py" "$CAP/game"
[ -n "$SKIP_MUSIC" ] || { "$PY" "$HERE/capture_music.py" "$CAP/music" && "$PY" "$HERE/make_bed.py" "$CAP/music/bed-128.wav"; }
# the site: the tour (16:9, cropped for the others) and the opening move natively at each shape, so the handheld's
# screen lands on whole pixels for each (the site's own ?cinematic=1 take)
if [ -z "$SKIP_SITE" ]; then
  PART=tour node "$HERE/capture_site.mjs" "$CAP/site" 1920 1080
  PART=manual node "$HERE/capture_site.mjs" "$CAP/site" 1920 1080
  for wh in "1920 1080" "1080 1920" "1080 1080"; do PART=cinematic node "$HERE/capture_site.mjs" "$CAP/site" $wh; done
fi
"$PY" "$HERE/build_trailer.py" "$CAP" "$HERE/.." ${MUSIC:+--music "$MUSIC"}
