#!/bin/zsh
set -eu
cd "${0:A:h}"
exec node scripts/start-test.mjs
