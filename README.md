# Forge Agent

A static web app (GitHub Pages, `docs/`) in which you build, rule, train and extend your own language model entirely in the browser. No model is downloaded, no server or account is used, and nothing is paywalled: every weight in a Forge model was produced on your device from what you typed, uploaded, corrected or approved.

Open `https://<your-username>.github.io/forge-agent/` (Repo Settings → Pages → Deploy from branch `main`, folder `/docs`). Add to Home Screen on a phone to run it as an app.

## Pages

Five labelled icon tabs (bottom bar on phones, top bar on desktop). Every action is a labelled icon button; nothing is a bare text box.

| Page | What it does |
|---|---|
| **Chat** | Start screen with one composer. Messages go to your active model; the line under each answer states which model and update produced it, whether your rules were in context, and that generation changed no weights. With automatic learning on, your messages and attached text files are queued as learning material. *Memory*, *Help* and *Train your model* sit under the composer; `/skills`, `/tool name {json}` and `/help` work too. |
| **Forge** | Code editor for the Forge language (Python-like syntax, plus the RPN kernel layer): line numbers, auto-indent, examples that have been run through Forge and matched against CPython, open/download/copy, autosave in the browser. Programs run natively with `forge/boot.sh` on Linux x86-64; the page says plainly that in-app execution needs an x86-64 emulator that has not been built. |
| **Train** | One page that replaced the old Models, Trainer and Rules pages. *Your model*: the model list with Use / Export / Open Chat / Delete, and a create form (name, seed, size cards from Tiny to Extra large or Custom, measure speed on this device, import a checkpoint). *Rules*: write, apply, remove, import/export, rule tests, draft history. *Teach*: a conversation where every turn can become training data — Teach, Ask, Correct previous answer, Upload — with pause/resume and the auto-learn switch; each committed weight change prints a green receipt (update range, byte targets, loss before/after, changed parameter count, SHA-256 before/after, rules context). *Evidence and export* holds the audit, re-tests of trained pairs and the checkpoint export. |
| **Skills** | Upload Markdown skills that carry real tool code. You read and approve the code, the tests run in a sandbox, then the tool is installed. *Queue training examples* teaches the active model to call the tool. See [SKILLS.md](SKILLS.md). |
| **Tutorial** | Seven numbered steps (build, rules, teach, skills, chat, write Forge programs, keep your work), what the model is, and a hands-on six-parameter math model to see a full train/evaluate loop in seconds. |

Old links to `#models`, `#trainer` and `#rules` open the Train page.

Colours: white = regular/your text; green = model output or a completed operation (not verified truth); red = error/rejected input; yellow = warnings, queued-not-yet-learned, heavy computation.

## How learning works

- Model: byte-level recurrent network (`docs/rnn-core.js`), parameters `2·256·H + H² + H + 256`. Truncated BPTT over 32-byte windows, SGD with gradient-norm clipping. Greedy decoding.
- Everything runs in a dedicated Web Worker (`docs/learning-worker.js`); weights, dataset, rules and receipts are committed to IndexedDB after every batch with optimistic revision checks.
- Text examples train next-byte prediction over the whole document; question→answer pairs train only the answer bytes (prompt and rules are context). Pairs run until the model reproduces the answer exactly or the pass budget is spent.
- Queued examples are trained round-robin with replay of older examples; when the queue drains, a consolidation pass re-tests every trained pair and re-queues (bounded) any the model has drifted away from.
- Rules are applied as a cached hidden state computed from the rules text (refreshed when rules change or every 16 updates); receipts and generation report the bytes and the update the state came from. Weights are not changed by changing rules — rule-following must be trained and measured.
- The model's answers are never used as training data unless you correct them. "False"/"wrong" style replies are recorded as text, not as answers.

## Skills and tools

A skill is a Markdown file with `forge-tool` (JavaScript `run(input)`), `forge-schema`, `forge-tests` and optional `forge-example` blocks. Installation requires your explicit approval of the shown code and every test passing inside the sandbox: an opaque-origin `<iframe sandbox="allow-scripts">` with `default-src 'none'` CSP running a Worker, with a timeout. Tools have no network, storage or page access. The model uses a tool by emitting `[tool:name] {json}`; Chat validates the JSON against the schema, runs the tool and shows the result. Format and a complete example: [SKILLS.md](SKILLS.md).

## Limits, stated plainly

- A fresh model outputs noise. A ~1 M-parameter byte model learns facts slowly, forgets, and generalises poorly; the receipts and tests exist so you can see exactly what it did and did not learn. Reproducing a trained example is not generalisation.
- Training speed is bound by your device. Measured in Node on the build machine: H=128 ≈ 32 ms per update, H=400 ≈ 130 ms, H=800 ≈ 400 ms. Phones are slower; use *Measure this size on this device*. Background tabs suspend training.
- Everything lives in this browser's storage; clearing site data deletes it. Export regularly.
- Verified in Linux Chromium (Playwright) only. iPhone Safari has not been tested by the author; the sandbox falls back from blob workers to data: URL workers for engines that need it, but that fallback is untested on a device.
- Browser memory and the 2 MiB dataset / 500 examples / 16 KiB rules / 2 KiB prompt limits are enforced without silent truncation.

## The Forge language (`forge/`)

`forge/` is the Forge language: a Linux x86-64 kernel whose whole toolchain was written as hexadecimal machine code (no compiler, assembler, linker or libc anywhere in the chain), an RPN standard library, and a Python-like front end (lexer, compiler, runtime) written in that RPN language. `./forge/boot.sh program.py` runs a Python-syntax program; `./forge/run_tests.sh` rebuilds the chain from the hex sources, verifies every stage byte-for-byte, and runs every test against checked-in CPython output. What it supports, what it deliberately does not, and measured performance are in [forge/README.md](forge/README.md). The Forge page of the app edits these programs; it does not execute them (see the page and the README for why).

## Tests

- `npm test` — Node unit tests (53): RNN gradient checks, parameter formula, seeds, rules conditioning, pair learning, data windows, skill format parsing/validation, tool-call parsing, memory/agent logic. Results: `validation/node-test-results.txt`.
- `python3 -m http.server 8765 --bind 127.0.0.1` then `python3 tests/browser-suite.py` — 22 end-to-end checks in headless Chromium at 390×844 (create model, rules, teaching receipts, sandbox isolation, skill install, tool execution, persistence, model switching). Results: `validation/browser-suite-results.json`.
- `python3 tests/browser-tool-learning.py` — slow check that a fresh model learns to emit a tool call and that Chat executes it. Results and caveats: `validation/browser-tool-learning.json`.

## Optional Python server

`agent/`, `supervisor.py`, `run.sh` are an earlier self-hosted variant (SQLite memory, Python standard library, local Ollama or mock). It is independent of the web app and not required. `python3 tests/test_agent.py`.
