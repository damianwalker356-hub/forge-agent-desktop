#!/bin/sh
# Rebuilds Forge from the hex chain and runs every test. Exit status 0 = everything verified.
set -e
cd "$(dirname "$0")"
echo "== rebuild chain: hex0.hex -> hex0 -> hex1 -> forge"
./hex0 < hex0.hex > hex0.rebuilt && cmp hex0 hex0.rebuilt && echo "hex0 reproduces itself"
./hex0 < hex1.hex0 > hex1.rebuilt && chmod +x hex1.rebuilt && cmp hex1 hex1.rebuilt && echo "hex1 reproduced by hex0"
./hex1.rebuilt < forge.hex1 > forge.rebuilt && chmod +x forge.rebuilt && cmp forge forge.rebuilt && echo "forge reproduced by hex1"
rm -f hex0.rebuilt hex1.rebuilt forge.rebuilt
echo "== RPN core library tests";      ./forge core.fg test_core.fg 2>/dev/null | tail -1
echo "== RPN language tests";          ./forge core.fg test_lang.fg 2>/dev/null | tail -1
echo "== 0.1 regression suite";    ./forge < test_full.in 2>/dev/null | cmp - expected/test_full.out && echo "identical to expected"
echo "== error recovery";          ./forge core.fg < test_errors.in 2>&1 | cmp - expected/test_errors.out && echo "identical to expected"
echo "== RPN demos"
./forge core.fg examples/orbit.fg  2>/dev/null | cmp - expected/orbit.out  && echo "orbit.fg  identical to Python reference"
./forge core.fg examples/piston.fg 2>/dev/null | cmp - expected/piston.out && echo "piston.fg identical to Python reference"
./forge core.fg examples/meta.fg   2>/dev/null | cmp - expected/meta.out   && echo "meta.fg   identical to expected"
./forge core.fg examples/render.fg >/dev/null 2>&1 && cmp render.ppm expected/render.ppm && echo "render.fg pixel-identical to Python reference" && rm -f render.ppm
echo "== Python-layer runtime unit tests (lang/rt.fg)"
for t in tests/rt1 tests/rt2 tests/rt3 tests/rt4; do ./forge core.fg lang/rt.fg $t.fg 2>/dev/null | tail -1; done
echo "== Python-syntax programs vs CPython expected output (tests/py/*.py)"
for f in tests/py/*.py; do
  ./boot.sh "$f" 2>&1 | grep -v '^Forge 1.0' | cmp - "${f%.py}.expected" && echo "$(basename $f) identical to CPython"
done
echo "ALL TESTS PASSED"
