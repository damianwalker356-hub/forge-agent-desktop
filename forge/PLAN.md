# Forge 2 plan and status (working notes)

User decisions (2026-11-06): runtime = BOTH (native Linux + in-browser x86-64 emulator running the real kernel);
syntax = Python-like front end PLUS RPN underneath; Forge Agent pages to keep = Chat, Forge code editor, Train
(merge Trainer+Rules+Models), Skills, Tutorial. Ask before pushing to GitHub (damianwalker356-hub/forge-agent).

## Workstreams
A. lang/   Python-like compiler written in Forge RPN on the 1.0 kernel            DONE for the feature set in README
B. emu/    JS x86-64 emulator for the kernel's instruction subset + Linux syscalls  NOT STARTED
C. app/    forge-agent redesign (Chat, Forge, Train, Skills, Tutorial)            NOT STARTED in this repo

## Status
- [x] A rt.fg (tagged values, arena, str/list/tuple/dict, ops, errors)      tests/rt1..4.fg
- [x] A fnum.fg (exact float printing and parsing)                           matched CPython on 317 random doubles
- [x] A lex.fg (indentation, numbers, strings, f-strings)
- [x] A comp.fg (statements, expressions, functions, comprehensions, ternary, is, slicing)
- [x] A builtins.fg (builtins, methods, %, format, math, random, time, sys)
- [x] A tests vs CPython: tests/py/*.py all identical (run_tests.sh)
- [ ] B emulator
- [ ] C app redesign
- [x] README rewritten with candid limits

## Known limits (see README "What it does not do")
no class/try/lambda/closures/nested def/first-class functions/kwargs/default args, no slice step,
no attribute access except method calls, no GC (arena), 64-bit ints, byte strings, xorshift random,
kernel f= treats NaN as equal to itself.

## Lessons kept for future work on the RPN layer
- `case` default branch must `drop` the selector and leave a dummy before `endcase`.
- kernel has no `2>r 2r> roll defer`; `argc` is a kernel word (use another name); float literals
  in .fg need a decimal point (`1.0 16 10^ f*`, not `1e16`).
- `cmove` is forward-only (use `cmove-back` for overlapping moves); `pick` is 0-based.
