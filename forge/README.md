# Forge 2 — a Python-like language running on a kernel built from raw machine code

Forge 2 is two layers:

1. **The kernel** (unchanged from Forge 1.0, plus one 1-line word `wall-ns`): a
   stack language for Linux x86-64 whose whole toolchain was written as
   hexadecimal machine code — no compiler, assembler, linker or libc anywhere in
   the chain. Its syntax is RPN (Forth-style).
2. **The Python-like front end** (`lang/*.fg`, new in 2.0): a lexer, compiler and
   runtime written *in the RPN language itself* and loaded by the kernel at start.
   It compiles Python-syntax programs to native subroutine-threaded code and runs
   them. Nothing pre-made is used at any level.

```
hex0.hex ──hex0──► hex0        255-byte hex-to-binary loader (the only hand-entered binary)
hex1.hex0 ─hex0──► hex1        747-byte loader that adds :labels and %rel32 references
forge.hex1 ─hex1─► forge       8,988-byte kernel: RPN compiler/interpreter, 100 primitives
core.fg   ─forge─► (loaded)    RPN standard library (90 words)
lang/rt.fg                     tagged values, arena, strings, lists, tuples, dicts (insertion-ordered), dynamic ops, errors
lang/fnum.fg                   exact float printing: shortest round-trip repr, %.Nf, correctly rounded str->float (bignum)
lang/lex.fg                    Python tokenizer: INDENT/DEDENT, numbers, strings, f-strings
lang/comp.fg                   recursive-descent compiler -> native code
lang/builtins.fg               builtins, str/list/dict methods, %, str.format, math, random, time, sys
lang/boot.fg                   loads a .py file, compiles, runs
```

`./run_tests.sh` rebuilds the chain from the hex sources, checks every stage
reproduces the shipped binary byte-for-byte, runs the RPN tests and demos, then
runs every `tests/py/*.py` program and compares its output with the checked-in
CPython output (`*.expected`). All of it passes as shipped.

## Running it

```
./boot.sh program.py                  # run a Python-syntax program (Python-like layer)
./forge core.fg program.fg            # run an RPN program on the bare kernel
./forge core.fg                       # RPN REPL; type  bye  to exit
./run_tests.sh                        # rebuild chain + every test
```

Program output goes to stdout; the banner and error messages go to stderr.
A runtime error prints `TypeError: ... (line N)` style messages and exits 1.
Unsupported syntax is reported at compile time as
`SyntaxError: not supported in Forge 2: <feature> (line N)` — nothing fails silently.

## What the Python-like layer supports (all verified against CPython)

- Values: 64-bit `int`, IEEE `float` (prints exactly like CPython, including
  `repr`, `%.Nf`, `%g`, `e`, `-0.0`, `inf`, `nan`), `str`, `bool`, `None`,
  `list`, `tuple`, `dict` (insertion-ordered, any hashable key).
- Statements: assignment (incl. tuple unpacking, `a, b = b, a`, augmented ops),
  `if/elif/else`, `while`, `for ... in` (lists, tuples, strings, dicts, `range`),
  `break`, `continue`, `def` with positional parameters and recursion, `return`,
  `global`, `del` (names and items), `assert`, `pass`, `import math/time/random/sys`,
  `from math import ...`.
- Expressions: full arithmetic incl. `**`, `//`, `%` with Python semantics on
  negatives, comparisons with chaining (`0 <= x < 1`), `and/or/not`, `in`,
  `is`, conditional expression `a if c else b`, list comprehensions with `if`,
  indexing and slicing (negative indexes, `a[1:3]`, no step), method calls,
  `%`-formatting, `str.format`, f-strings with format specs (`f"{x:08.2f}"`).
- Builtins: `print(..., sep=, end=)`, `input`, `len`, `range`, `str`, `int`,
  `float`, `bool`, `repr`, `type`, `abs`, `round`, `divmod`, `pow`, `min`, `max`,
  `sum`, `any`, `all`, `sorted`, `reversed`, `enumerate`, `zip`, `list`, `tuple`,
  `ord`, `chr`, `hex`, `exit`.
- Methods: str `upper lower strip lstrip rstrip split join find index count
  replace startswith endswith isdigit isalpha isspace isalnum capitalize title
  zfill center format`; list `append extend pop insert remove index count reverse
  sort copy clear`; dict `keys values items get pop setdefault update copy clear`.
- Modules: `math` (sqrt sin cos tan asin acos atan atan2 log log10 log2 exp floor
  ceil fabs hypot degrees radians isnan isinf trunc gcd factorial pow, pi e tau
  inf nan), `time.time / perf_counter / sleep`, `random.random / seed / randint /
  choice / uniform / shuffle`, `sys.maxsize`.

`tests/py/` holds the evidence: `basics control floats tuples dicts formatting
fstrings builtins physics` (the last is an orbit integrator, slider-crank
kinematics, recursion and dict word-count in one file).

## What it does not do (read this before relying on it)

Design limits of this release, stated so nobody mistakes it for CPython:

- **Not supported (compile-time error):** `class`, `try/except/raise`, `lambda`,
  nested `def`, closures, functions as values, default/keyword arguments (except
  `print`'s `sep`/`end`), `yield`, `with`, generator expressions, set literals,
  dict comprehensions, slice steps and slice assignment, `for/while ... else`,
  `import ... as`, attribute access other than method calls (`obj.name` without
  `(...)`), decorators, string escapes beyond `\n \t \\ \" \' \xNN`.
- **Differences:** integers are 64-bit and wrap (no bignum); strings are byte
  strings (no Unicode awareness in `len`/`upper`); `type(x)` returns the type
  name as a string; `range(...)` and `enumerate/zip/reversed/dict.keys()` return
  lists eagerly; `random` is xorshift, not Mersenne Twister, so sequences differ
  from CPython for the same seed; float comparisons involving NaN follow the
  kernel's `f=`, which treats NaN as equal to itself (`math.isnan` is correct).
- **No garbage collector:** memory is a bump arena over `mmap`; long-running
  loops that build many strings or lists keep growing. Fine for scripts and
  simulations of the size in `examples/`, not for servers.
- **Linux x86-64 only.** No in-browser or iPhone execution exists yet: the
  x86-64 emulator that would run this kernel inside the Forge Agent app was
  planned (see `PLAN.md`) and has **not** been built.
- Performance: straightforward subroutine-threaded code with dynamic type
  dispatch on every operation and no optimizer. Measured on the build machine:
  `fib(27)` 1.26 s vs 0.04 s for the installed python3; a 1,000,000-iteration
  float loop 1.32 s vs 0.08 s. Expect 15-35x slower than CPython.

## The RPN layer (still fully available)

Everything below is the Forge 1.0 kernel and library, which the Python-like
layer is written in. A `.fg` file is RPN source; `.py` is Python-like source.

| Capability | Forge 0.1 | Forge 1.0 | How 1.0 was verified |
|---|---|---|---|
| Integers, arithmetic, compares, bit ops | yes | yes, plus `mod lshift rshift invert negate u< 1+ 1-` | `test_lang.fg` |
| Floating point | none | IEEE double on the data stack: literals `3.14 .5 -1.5`, `f+ f- f* f/ fsqrt f< f> f= s>f f>s fround`, `fsin fcos fatan2 fln fexp` (x87) | x87 results bit-identical to Python's libm on sampled inputs; `examples/orbit.fg`, `piston.fg` and `render.fg` reproduce Python reference output digit-for-digit / pixel-for-pixel |
| Control flow | if/else, begin/until, begin/while/repeat, do/loop, exit, recursion | same plus `+loop`, `j`, `case/of/endof/endcase` (library), user-defined structures via `postpone` | `test_lang.fg`, `examples/meta.fg` |
| Memory | 1 MB fixed arena | 192 MB code/data arena plus unbounded `allocate` (mmap) | `test_lang.fg` (1 MB heap block), `render.fg` (192 KB framebuffer) |
| Programs from files | stdin only; one typo discarded the rest of the input | `./forge a.fg b.fg` loads files in order; `include`; REPL afterwards | all demos run from files |
| Errors | silent stop | message with line number; half-built definition unlinked; REPL continues, file mode exits 1 | `test_errors.in` |
| File and OS access | raw `syscall` only | `open-file create-file read-file write-file close-file`, `argc argv`, `now-ns`, raw `syscall` for anything else | `test_lang.fg` round-trips a file and unlinks it; `render.fg` writes a PPM |
| Metaprogramming | none | `: ; ' ['] execute literal compile, postpone [compile] create constant array token parse find latest state@ [ ] immediate compile-only recurse` — code can define code | `meta.fg` builds a control structure, a struct generator, a DSL, and generates a word from run-time values |
| Strings | `s" ..."` `type` | plus `z" ..."` C strings, `str=`, `>z`, `count`, `cmove`, `fill` | `test_lang.fg` |
| Output formatting | `.` | plus `.r f. f.3 hex. dump .s` | demos |

### RPN-layer limits

These are design limits, stated so nobody mistakes 1.0 for something it is not.

- **Linux x86-64 only.** The kernel talks to the CPU and the Linux syscall ABI
  directly. There is no portability layer.
- **Syntax of this layer is reverse Polish.** The Python-like layer (above) is
  the Phase 4 front end written in it.
- **No garbage collector**, no bounds checks, no type checks. A wrong pointer
  segfaults, exactly as in C. (This happened once while writing `meta.fg`; the
  bug was in the example, not the kernel, but the failure mode is real.)
- **DO/LOOP always runs its body at least once** (no `?do`); `+loop` is for
  positive steps only. No `does>`.
- **Floats**: `f.` prints garbage for NaN, ±inf or |x| ≥ 2^63; `f=` is exact
  equality; no exponent notation (`1e5` is not a literal).
- Booleans are `1`/`0` (standard Forth uses −1 for true).
- `variable` is immediate (kernel); `'` is not (use `[']` inside definitions);
  `:` takes the next token literally, so `: ( comment )` names the word `(`.
- Errors inside included files are fatal (exit 1) — intended for scripts.
- No performance work: the compiler emits straightforward subroutine-threaded code
  (`call` per word). `render.fg` traces 65,536 rays in ~170 ms, which is adequate,
  not fast.

## Examples (all outputs verified)

| File | What it does | Verification |
|---|---|---|
| `examples/orbit.fg` | Symplectic Euler two-body orbit, 9,000 steps, energy drift report | output identical to a Python implementation, every digit |
| `examples/piston.fg` | Slider-crank kinematics for an 86×86 mm, 143.5 mm rod cylinder at 7,000 rpm: position, velocity, polytropic compression pressure, peak-speed scan | identical to Python, every digit |
| `examples/render.fg` | Ray tracer: sphere with Phong highlight, checkerboard floor, cast shadow, sky gradient; writes a 256×256 PPM via mmap buffer + file syscalls | all 196,608 pixel bytes identical to a Python port; `examples/render.png` is the converted image |
| `examples/meta.fg` | The language extending itself: `times…end` control structure, struct generator, declarative DSL, run-time code generation, `case/of` | expected output checked in |

## Layout

```
hex0.hex hex1.hex0 forge.hex1   the three machine-code stages as commented hex text
hex0 hex1 forge                 the binaries they produce (reproduced by run_tests.sh)
core.fg                         RPN standard library
lang/                           Python-like layer: rt.fg fnum.fg lex.fg comp.fg builtins.fg boot.fg
boot.sh                         ./boot.sh prog.py
tests/py/*.py *.expected        Python-syntax programs with CPython reference output
tests/rt1..4.fg                 unit tests for lang/rt.fg
test_core.fg test_lang.fg       RPN tests (45 + 72 checks)      test_full.in test_errors.in  regression scripts
examples/                       physics.py (Python-like) and orbit.fg piston.fg render.fg meta.fg (RPN)
expected/                       checked-in expected outputs
PLAN.md                         working notes, decisions and status
run_tests.sh                    rebuilds everything and verifies it
```

## Kernel reference (100 words)

```
stack      dup drop swap over rot >r r> r@ sp@
integer    + - * / mod 1+ 1- negate invert and or xor lshift rshift
compare    = <> < > <= >= u< 0= not
float      f+ f- f* f/ fsqrt f< f> f= s>f f>s fround fsin fcos fatan2 fln fexp
memory     @ ! c@ c! here allot cells cmove variable create
control    if else then begin until while repeat do loop +loop i j unloop exit
compiler   : ; ' ['] literal compile, [ ] state@ latest execute token parse find
i/o        emit cr space type . (.) s" ." words include (include) abort bye syscall
```

Primitives clobber only rax/rcx/rdx/rsi/rdi/r8–r11; r14 is the data stack pointer
(grows down), rbx the control-flow stack, r12 HERE, r13 LATEST, rbp STATE.
Dictionary entry: `[link 8][flags 8][namelen 8][name pad8][codeptr 8]`, flags bit0 =
immediate, bit1 = compile-only. `syscall` takes `a1 a2 a3 a4 a5 a6 n -- result`.

## Bugs found and fixed during 1.0 (so the method is visible)

Every bug was found by disassembling the built binary with objdump and comparing
against the intended instruction, then fixed in `forge.hex1`:

- `rot` was emitting the stores of `swap` (wrong register in `mov [r14+16]`).
- `syscall` loaded r8/r10 with REX `4c` instead of `4d`, so arguments 4–5 were
  wrong; earlier tests passed only because `write`/`getpid` ignore them.
- Float compares read the flags after `add r14,8` had clobbered them.
- Compile-only checking for `exit`/`i`/`unloop` moved from a runtime rbp test to a
  dictionary flag.
- `:` and `;` were hardwired into the interpreter loop and could not be used from
  code; they are now ordinary dictionary words, which is what makes `meta.fg`'s
  run-time code generation possible.
