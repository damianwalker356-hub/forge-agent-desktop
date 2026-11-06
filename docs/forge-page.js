// Forge page: a code editor for the Forge language (Python-like syntax, plus the RPN kernel layer).
// Programs are written and kept here; they run with the native Linux x86-64 build in the repository's
// forge/ folder. In-browser execution needs an x86-64 emulator for the kernel, which does not exist yet,
// so this page says so plainly instead of pretending to run code.
import { $, el, setStatus } from './page-utils.js';
import { icon, iconButton } from './icons.js';
const host = $('forgePage'), KEY = 'forge_editor_v1';
const EXAMPLES = [
  ['hello', 'Hello (Python-like)', null],
  ['basics.py', 'Basics — ints, strings, lists', 'forge-examples/basics.py'],
  ['dicts.py', 'Dicts and loops', 'forge-examples/dicts.py'],
  ['fstrings.py', 'f-strings and formatting', 'forge-examples/fstrings.py'],
  ['physics.py', 'Physics — orbit, piston, recursion', 'forge-examples/physics.py'],
  ['orbit.fg', 'Orbit in RPN (kernel layer)', 'forge-examples/orbit.fg'],
];
const HELLO = `# Forge — Python-like syntax compiled to native code by a kernel written in raw machine code.
import math

def area(bore_mm, stroke_mm, cylinders):
    r = bore_mm / 2
    return math.pi * r * r * stroke_mm * cylinders / 1000

names = ["Miata", "Supra", "GT-R"]
for i, n in enumerate(names):
    print(f"{i}: {n:<6} {len(n)} letters")

print("Displacement:", round(area(86, 86, 8), 1), "cc")
`;
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
const editorBox = el('div', { class: 'editor' }, el('div', { class: 'gutter', 'aria-hidden': 'true', text: '1' }),
  el('textarea', { id: 'fgCode', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': 'Forge source code', placeholder: 'Write a Forge program here…' }));
host.append(
  el('div', { class: 'card' }, el('h2', {}, icon('forge', 20), 'Editor'),
    el('div', { class: 'row' },
      el('label', { class: 'inline' }, 'File name', el('input', { id: 'fgName', value: saved.name || 'program.py', maxlength: '64', autocomplete: 'off', style: 'width:200px' })),
      el('label', { class: 'inline' }, 'Example', el('select', { id: 'fgExample', 'aria-label': 'Load an example' }, el('option', { value: '', text: 'Load an example…' }), ...EXAMPLES.map(([id, label]) => el('option', { value: id, text: label }))))),
    editorBox,
    el('div', { class: 'statusBar' }, el('span', { id: 'fgInfo' }), el('span', { id: 'fgSaved', role: 'status' })),
    el('div', { class: 'actions' },
      iconButton('download', 'Download', { id: 'fgDownload', class: 'primary' }), iconButton('copy', 'Copy', { id: 'fgCopy' }),
      el('label', { class: 'inline' }, el('span', { class: 'ib quiet', style: 'cursor:pointer' }, icon('upload'), 'Open file…'), el('input', { id: 'fgOpen', type: 'file', accept: '.py,.fg,.txt', hidden: true })),
      iconButton('trash', 'Clear', { id: 'fgClear', class: 'danger' })),
    el('p', { id: 'fgStatus', role: 'status', hidden: true })),
  el('div', { class: 'card' }, el('h2', {}, icon('run', 20), 'How to run it'),
    el('p', { text: 'Forge runs natively on Linux x86-64. Download your program, put it next to the forge folder from this repository, and run:' }),
    el('pre', { text: 'cd forge\n./boot.sh ../program.py        # Python-like syntax\n./forge core.fg program.fg     # RPN (kernel layer)\n./run_tests.sh                 # rebuild the whole chain from hex and run every test' }),
    el('div', { class: 'note' }, el('strong', { text: 'Running inside this app is not available yet. ' }), el('span', { text: 'The kernel is x86-64 machine code, so running it on an iPhone or in a browser needs an x86-64 emulator written in JavaScript. That emulator has not been built; this page edits and stores programs but does not execute them. Nothing here fakes output.' })),
    el('p', { class: 'sub' }, 'Source, tests and the bootstrap chain: ', el('a', { href: 'https://github.com/damianwalker356-hub/forge-agent/tree/main/forge', target: '_blank', rel: 'noopener', text: 'forge/ in the repository' }), '. Every example on this page has been run through Forge and matched against CPython output.')),
  el('details', {}, el('summary', { text: 'What Forge understands' }),
    el('div', { class: 'grid2' },
      el('div', {}, el('h3', { text: 'Python-like layer' }), el('p', { class: 'sub', text: 'int (64-bit), float, str, bool, None, list, tuple, dict (insertion-ordered). if/elif/else, while, for…in, break/continue, def with recursion, return, global, del, assert, import math/time/random/sys. Arithmetic with Python semantics (**, //, % on negatives), chained comparisons, and/or/not, in, is, conditional expressions, list comprehensions, slicing (no step), %-formatting, str.format, f-strings with format specs. print, len, range, str, int, float, repr, type, abs, round, divmod, pow, min, max, sum, any, all, sorted, reversed, enumerate, zip, ord, chr, hex, input, exit.' })),
      el('div', {}, el('h3', { text: 'Not supported (reported as a SyntaxError, never silent)' }), el('p', { class: 'sub', text: 'class, try/except/raise, lambda, nested def, closures, functions as values, default or keyword arguments (except print sep/end), yield, with, generator expressions, sets, dict comprehensions, slice steps, for/while…else, import…as, decorators, attribute access other than method calls. Strings are byte strings; integers wrap at 64 bits; random is xorshift; there is no garbage collector; Linux x86-64 only. About 15–35× slower than CPython.' })))));
const code = $('fgCode'), gutter = editorBox.firstChild;
function lines() { const n = code.value.split('\n').length; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); $('fgInfo').textContent = `${n} line${n === 1 ? '' : 's'} · ${new TextEncoder().encode(code.value).length} bytes · ${/\.fg$/i.test($('fgName').value) ? 'RPN (.fg)' : 'Python-like (.py)'}`; }
let saveTimer;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { localStorage.setItem(KEY, JSON.stringify({ name: $('fgName').value, code: code.value })); $('fgSaved').textContent = 'Saved in this browser'; }, 300); }
code.value = saved.code ?? HELLO; lines();
code.addEventListener('input', () => { lines(); persist(); });
code.addEventListener('scroll', () => { gutter.scrollTop = code.scrollTop; });
code.addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart, t = code.selectionEnd; code.setRangeText('    ', s, t, 'end'); lines(); persist(); }
  if (e.key === 'Enter') { // keep indentation, add a level after a colon
    const s = code.selectionStart, before = code.value.slice(0, s), line = before.slice(before.lastIndexOf('\n') + 1), ind = /^\s*/.exec(line)[0] + (/:\s*$/.test(line) ? '    ' : '');
    if (ind) { e.preventDefault(); code.setRangeText('\n' + ind, s, code.selectionEnd, 'end'); lines(); persist(); }
  }
});
$('fgName').addEventListener('input', () => { lines(); persist(); });
$('fgExample').onchange = async e => {
  const ex = EXAMPLES.find(x => x[0] === e.target.value); e.target.value = ''; if (!ex) return;
  if (code.value.trim() && code.value !== HELLO && !confirm('Replace the current program with the example? Download it first if you want to keep it.')) return;
  try {
    code.value = ex[2] ? await (await fetch(ex[2])).text() : HELLO; $('fgName').value = ex[2] ? ex[0] : 'hello.py'; lines(); persist();
    setStatus($('fgStatus'), `Loaded ${ex[1]}.`, 'ok');
  } catch (x) { setStatus($('fgStatus'), 'Could not load the example: ' + x.message, 'error'); }
};
$('fgDownload').onclick = () => {
  const name = $('fgName').value.trim() || 'program.py', url = URL.createObjectURL(new Blob([code.value], { type: 'text/plain' })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); setStatus($('fgStatus'), `Download of ${name} requested.`, 'ok');
};
$('fgCopy').onclick = async () => { try { await navigator.clipboard.writeText(code.value); setStatus($('fgStatus'), 'Copied to the clipboard.', 'ok'); } catch { setStatus($('fgStatus'), 'Clipboard access was refused; select the text and copy it manually.', 'caution'); } };
$('fgOpen').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (f.size > 262144) { setStatus($('fgStatus'), 'File exceeds 256 KiB.', 'error'); return; } code.value = await f.text(); $('fgName').value = f.name; lines(); persist(); setStatus($('fgStatus'), `Opened ${f.name}.`, 'ok'); };
$('fgClear').onclick = () => { if (!confirm('Clear the editor?')) return; code.value = ''; lines(); persist(); setStatus($('fgStatus'), 'Editor cleared.', 'regular'); };
