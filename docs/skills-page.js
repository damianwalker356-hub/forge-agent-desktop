// Skills page: upload a Markdown skill, review its code, run its tests in the sandbox, install it, and optionally
// queue its examples so the active model learns when to call the tool.
import { skillRegistry, runSkillTests } from './skill-registry.js';
import { parseSkill, codeHash, validateInput } from './skill-format.js';
import { modelService } from './model-service.js';
import { $, el, fmt, setStatus, readTextFiles } from './page-utils.js';
import { icon, iconButton } from './icons.js';
const host = $('skillsPage');
host.append(
  el('p', { text: 'A skill is one Markdown file: instructions for you, a forge-tool JavaScript block that defines run(input), a forge-schema for its input, forge-tests that must pass, and optional forge-example pairs. Installed tools run in an isolated sandbox with no network, storage or page access. Your model gains the tool by learning to emit a call such as [tool:name] {"field": 1}; the application runs the tool and shows the result.' }),
  el('p', { id: 'skSandbox', role: 'status', class: 'modelLine' }),
  el('div', { class: 'card' }, el('h2', {}, icon('skills', 20), 'Add a skill'), el('div', { class: 'row' }, iconButton('upload', 'Upload a skill (.md)', { class: 'primary', onclick: () => $('skFile').click() }), el('input', { id: 'skFile', type: 'file', accept: '.md', hidden: true }), iconButton('download', 'Download a template skill', { id: 'skTemplate' })), el('div', { id: 'skPreview' }), el('p', { id: 'skStatus', role: 'status', hidden: true })),
  el('div', { class: 'card' }, el('h2', { text: 'Installed skills' }), el('div', { id: 'skList', class: 'list' }), el('p', { id: 'skListStatus', role: 'status', hidden: true })));
const status = (t, tone) => setStatus($('skStatus'), t, tone);
let pending = null, busy = false;
async function act(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { status(e.message + (e.report ? '\n' + reportText(e.report) : ''), 'error'); } finally { busy = false; renderList(); } }
function reportText(report) { return report.results.map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}` + (r.ok ? '' : ` — ${r.stage}: ${r.error}` + (r.actual !== undefined ? ` (actual ${JSON.stringify(r.actual)})` : ''))).join('\n') + (report.mode ? `\nsandbox: ${report.mode}` : ''); }
async function sandboxLine() {
  const s = await skillRegistry.checkSandbox();
  setStatus($('skSandbox'), s.ok ? `Sandbox check passed in this browser (${s.mode}; network, storage, page and importScripts all unreachable; ${s.milliseconds.toFixed(0)} ms).` : `Sandbox unavailable or not isolated: ${s.error || 'unknown'}. Tools cannot be installed or run here.`, s.ok ? 'ok' : 'error');
}
function preview(parsed, file) {
  pending = { parsed, file, approvedHash: null };
  const box = $('skPreview'); box.replaceChildren();
  box.append(el('h3', { text: `${parsed.name} v${parsed.version} — ${parsed.kind === 'tool' ? 'tool skill' : parsed.kind === 'examples' ? 'training examples only' : 'reference text only'}` }), parsed.description && el('p', { text: parsed.description }));
  for (const w of parsed.warnings) box.append(el('p', { dataset: { tone: 'caution' }, text: w }));
  box.append(el('p', { class: 'muted', text: `${fmt(parsed.bytes)} bytes · ${parsed.tests.length} test(s) · ${parsed.examples.length} example pair(s) · ${parsed.toolExamples.length} prompt→tool-call pair(s) from tests` }));
  if (parsed.tool) {
    box.append(el('p', { text: `Tool ${parsed.tool.name} — input fields: ${Object.entries(parsed.tool.schema).map(([k, d]) => `${k} (${d.type}${d.min !== undefined ? ` ≥${d.min}` : ''}${d.max !== undefined ? ` ≤${d.max}` : ''}${d.required === false ? ', optional' : ''})`).join(', ') || 'none'}` }));
    box.append(el('p', { dataset: { tone: 'caution' }, text: 'Read the code before approving. It runs only in the sandbox, but it will run with whatever input your model or you supply.' }), el('pre', { class: 'codeBox', text: parsed.tool.code }));
    const approve = el('label', {}, el('input', { id: 'skApprove', type: 'checkbox' }), 'I have read this code and approve installing it');
    box.append(approve, el('div', { class: 'actions' }, iconButton('run', 'Run tests in sandbox', { onclick: () => act(async () => { status('Running tests…', 'caution'); const r = await runSkillTests(parsed); status(`${r.passed}/${r.total} tests passed.\n` + reportText(r), r.ok ? 'ok' : 'error'); }) }), iconButton('check', 'Install skill', { class: 'primary', onclick: () => act(install) })));
  } else box.append(el('div', { class: 'actions' }, iconButton('check', 'Install skill', { class: 'primary', onclick: () => act(install) })));
  if (parsed.instructions) box.append(el('details', {}, el('summary', { text: 'Instructions text' }), el('pre', { text: parsed.instructions })));
}
async function install() {
  if (!pending) throw Error('Choose a skill file first');
  const { parsed, file } = pending;
  const approvedCodeHash = parsed.tool ? ($('skApprove')?.checked ? await codeHash(parsed.tool.code) : null) : null;
  if (parsed.tool && !approvedCodeHash) throw Error('Tick the approval box after reading the code');
  status('Testing and installing…', 'caution');
  const { record, report } = await skillRegistry.install(file.text, { filename: file.name, approvedCodeHash });
  status(`Installed ${record.name} v${record.version}` + (report ? ` after ${report.passed}/${report.total} tests passed (${report.mode}).` : ' (no tool; text/examples only).') + ' The model does not know the tool exists until you queue its examples below or teach it yourself.', 'ok');
  $('skPreview').replaceChildren(); pending = null;
}
$('skFile').onchange = async e => {
  try { const [file] = await readTextFiles(e.target.files, { maxFiles: 1, maxTotalBytes: 262144 }); if (!file) return; preview(parseSkill(file.text, { filename: file.name }), file); status(`Parsed ${file.name}. Review below.`, 'regular'); }
  catch (x) { $('skPreview').replaceChildren(); pending = null; status(x.message, 'error'); } finally { e.target.value = ''; }
};
$('skTemplate').onclick = () => {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/markdown' })), a = document.createElement('a'); a.href = url; a.download = 'engine-displacement.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
};
// Allow other pages (Train/Chat uploads) to hand a skill file here for review.
modelService.addEventListener('skill-files', ({ detail }) => { const file = detail.files[0]; try { preview(parseSkill(file.text, { filename: file.name }), file); status(`${file.name} from your upload is ready for review here (Skills page).`, 'caution'); } catch (x) { status(`${file.name}: ${x.message}`, 'error'); } });
function runForm(record) {
  const fields = Object.entries(record.tool.schema), inputs = {};
  const form = el('form', { class: 'row', onsubmit: e => { e.preventDefault(); act(async () => {
    const raw = {}; for (const [k, d] of fields) { const v = inputs[k].value; if (v === '') continue; raw[k] = d.type === 'number' || d.type === 'integer' ? Number(v) : d.type === 'boolean' ? v === 'true' : v; }
    validateInput(record.tool.schema, raw);
    const out = await skillRegistry.callTool(record.tool.name, raw);
    result.textContent = out.ok ? (out.rendered ? out.rendered + '\n' : '') + JSON.stringify(out.result, null, 2) + `\n(${out.mode}, ${out.milliseconds.toFixed(0)} ms; model call text: ${out.call})` : 'Error: ' + out.error; result.dataset.tone = out.ok ? 'ok' : 'error';
  }); } });
  for (const [k, d] of fields) { inputs[k] = el('input', { type: d.type === 'string' ? 'text' : d.type === 'boolean' ? 'text' : 'number', step: d.type === 'integer' ? '1' : 'any', placeholder: d.type + (d.required === false ? ' (optional)' : ''), 'aria-label': k }); form.append(el('label', {}, k + ' ', inputs[k])); }
  form.append(iconButton('run', 'Run tool', { type: 'submit' }));
  const result = el('pre', { 'aria-live': 'polite' });
  return el('details', {}, el('summary', { text: 'Run this tool manually' }), form, result);
}
function renderList() {
  const list = $('skList'); list.replaceChildren();
  const skills = skillRegistry.list();
  setStatus($('skListStatus'), skills.length ? '' : 'No skills installed.', 'regular');
  for (const r of skills) {
    const enabled = r.status === 'installed';
    list.append(el('div', { class: 'item' },
      el('h3', { text: `${r.name} v${r.version}` + (r.tool ? ` — tool ${r.tool.name}` : '') + (enabled ? '' : ' — disabled'), dataset: { tone: enabled ? 'ok' : 'caution' } }),
      r.description && el('p', { text: r.description }),
      el('p', { class: 'muted', text: `installed ${new Date(r.installedAt).toLocaleString()}` + (r.testReport ? ` · tests ${r.testReport.passed}/${r.testReport.total} passed (${r.testReport.mode})` : '') + ` · ${r.examples} example pair(s) · ${r.toolExamples} tool-call pair(s)` + (r.tool ? ` · code sha256 ${r.tool.codeHash.slice(0, 12)}` : '') }),
      el('div', { class: 'actions' },
        iconButton(enabled ? 'pause' : 'resume', enabled ? 'Disable' : 'Enable', { onclick: () => act(() => skillRegistry.setEnabled(r.name, !enabled)) }),
        (r.examples + r.toolExamples) > 0 && iconButton('teach', 'Queue training examples for the active model', { onclick: () => act(async () => {
          const examples = skillRegistry.trainingExamples(r.name); let queued = 0;
          for (let i = 0; i < examples.length; i += 25) { await modelService.enqueue(examples.slice(i, i + 25)); queued += Math.min(25, examples.length - i); }
          status(`Queued ${queued} example(s) from ${r.name} for model ${modelService.activeId}. Queued is not learned: watch for green receipts on the Train page, then test the prompts in Chat.`, 'ok');
        }) }),
        iconButton('folder', 'Show source', { onclick: () => { const pre = el('pre', { class: 'codeBox', text: r.source }); list.querySelector(`[data-src="${r.name}"]`)?.remove(); pre.dataset.src = r.name; list.append(pre); } }),
        iconButton('trash', 'Remove', { class: 'danger', onclick: () => act(async () => { if (!confirm(`Remove skill ${r.name}? The model keeps anything it already learned about it.`)) return; await skillRegistry.remove(r.name); status(`Removed ${r.name}.`, 'ok'); }) })),
      r.tool && enabled && runForm(r)));
  }
}
skillRegistry.addEventListener('change', renderList);
document.addEventListener('forge:page', ({ detail }) => { if (detail.page === 'skills') { renderList(); sandboxLine(); } });
export const TEMPLATE = `---
name: engine-displacement
version: 1
description: Swept displacement of a piston engine from bore, stroke and cylinder count.
tool: engine_displacement
output_format: "Displacement: {displacement_liters:3} L ({displacement_cc:0} cc) from {cylinders} cylinders"
---
# Engine displacement

Swept volume per cylinder is \\(\\pi/4 \\cdot bore^2 \\cdot stroke\\); total displacement multiplies by the cylinder count.
Bore and stroke are in millimetres; results are in cubic centimetres and litres.

\`\`\`forge-schema
{
  "bore_mm": { "type": "number", "min": 1, "max": 1000 },
  "stroke_mm": { "type": "number", "min": 1, "max": 1000 },
  "cylinders": { "type": "integer", "min": 1, "max": 64 }
}
\`\`\`

\`\`\`forge-tool
function run(input) {
  const perCylinderMm3 = Math.PI / 4 * input.bore_mm * input.bore_mm * input.stroke_mm;
  const cc = perCylinderMm3 * input.cylinders / 1000;
  return { displacement_cc: cc, displacement_liters: cc / 1000, cylinders: input.cylinders };
}
\`\`\`

\`\`\`forge-tests
[
  { "name": "Miata 1.8 BP", "prompt": "What is the displacement of an 83 mm bore, 85 mm stroke four cylinder?", "input": { "bore_mm": 83, "stroke_mm": 85, "cylinders": 4 }, "expected": { "displacement_liters": 1.839 }, "absolute_tolerance": 0.001 },
  { "name": "square V8", "prompt": "Displacement for a V8 with 86 mm bore and 86 mm stroke?", "input": { "bore_mm": 86, "stroke_mm": 86, "cylinders": 8 }, "expected": { "displacement_cc": 3996.46 }, "absolute_tolerance": 0.01 },
  { "name": "rejects zero bore", "input": { "bore_mm": 0, "stroke_mm": 86, "cylinders": 8 }, "expect_error": true }
]
\`\`\`

\`\`\`forge-example
{ "prompt": "Work out the displacement of a 4 cylinder, 86 mm bore, 86 mm stroke engine", "response": "[tool:engine_displacement] {\\"bore_mm\\":86,\\"stroke_mm\\":86,\\"cylinders\\":4}" }
\`\`\`
`;
await skillRegistry.ready.catch(e => setStatus($('skListStatus'), 'Skill storage failed: ' + e.message, 'error'));
renderList(); sandboxLine();
