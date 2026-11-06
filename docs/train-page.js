// Train page: one place to build a model, give it rules, teach it, and inspect the evidence.
// It replaces the former Models, Rules and Trainer pages; element IDs are kept so existing tests still apply.
// Every model starts from random weights chosen by a seed; nothing pretrained is shipped or downloaded.
import { modelService as service } from './model-service.js';
import { parameterCount, MIN_H, MAX_H, MAX_RULES_BYTES } from './rnn-core.js';
import { readRecord, createRecord, saveRecord } from './model-records.js';
import { $, el, fmt, short, setStatus, download, readTextFiles, receiptText } from './page-utils.js';
import { icon, iconButton } from './icons.js';
import { showPage } from './ui.js';
const enc = new TextEncoder(), host = $('trainPage');
const SIZES = [[64, 'Tiny', 'very fast, learns little'], [128, 'Small', 'fast on phones'], [256, 'Medium', 'moderate'], [400, 'Large', 'slow on phones'], [800, 'Extra large', 'seconds per update on phones']];
const h2 = (name, text) => el('h2', {}, icon(name, 20), text);
// ---------- 1. Your model ----------
const sizePick = el('div', { class: 'sizePick', role: 'group', 'aria-label': 'Model size' });
host.append(
  el('div', { class: 'card' }, h2('sparkle', 'Your model'),
    el('p', { id: 'ctModelState', role: 'status', class: 'modelLine' }),
    el('div', { id: 'mbList', class: 'list' }), el('p', { id: 'mbListStatus', role: 'status', hidden: true }),
    el('details', { id: 'mbCreateBox' }, el('summary', { text: 'Create a new model' }),
      el('p', { class: 'sub', text: 'A model is a byte-level network trained only by you, in this browser, on what you type, upload, correct and approve. Bigger models can learn more, but every update takes longer on this device.' }),
      el('div', { class: 'row' },
        el('label', {}, 'Name', el('input', { id: 'mbId', maxlength: '64', placeholder: 'my-first-model', autocomplete: 'off' })),
        el('label', {}, 'Seed (optional)', el('input', { id: 'mbSeed', type: 'number', step: '1', placeholder: 'random' }))),
      el('p', { class: 'sub', style: 'margin:8px 0 0', text: 'Size' }), el('select', { id: 'mbH', class: 'srOnly', 'aria-label': 'Model size', tabindex: '-1' }, ...SIZES.map(([h, name, note]) => el('option', { value: String(h), selected: h === 128 || undefined, text: `${name} — hidden ${h} — ${fmt(parameterCount(h))} parameters — ${note}` })), el('option', { value: 'custom', text: 'Custom…' })),
      sizePick,
      el('label', { id: 'mbCustomLabel', hidden: true }, 'Custom hidden size', el('input', { id: 'mbCustom', type: 'number', min: String(MIN_H), max: String(MAX_H), step: '1', value: '200' })),
      el('p', { id: 'mbParams', class: 'sub' }),
      el('div', { class: 'actions' }, iconButton('plus', 'Create model', { id: 'mbCreate', class: 'primary' }), iconButton('gauge', 'Measure speed on this device', { id: 'mbBench' })),
      el('p', { id: 'mbStatus', role: 'status', hidden: true }),
      el('p', { class: 'sub', text: 'Or import a checkpoint exported by this app (format forge-rnn-v1). It is saved under the name above; existing models are never overwritten.' }),
      el('label', {}, 'Import checkpoint', el('input', { id: 'mbImport', type: 'file', accept: '.json' })))));
for (const [h, name, note] of SIZES) {
  sizePick.append(el('button', { type: 'button', dataset: { h: String(h) }, onclick: () => { $('mbH').value = String(h); $('mbH').dispatchEvent(new Event('change')); } }, el('strong', { text: name }), el('small', { text: `${fmt(parameterCount(h))} parameters · ${note}` })));
}
sizePick.append(el('button', { type: 'button', dataset: { h: 'custom' }, onclick: () => { $('mbH').value = 'custom'; $('mbH').dispatchEvent(new Event('change')); } }, el('strong', { text: 'Custom' }), el('small', { text: 'choose the hidden size yourself' })));
// ---------- 2. Rules ----------
host.append(
  el('div', { class: 'card' }, h2('book', 'Rules'),
    el('p', { id: 'ruModel', role: 'status', class: 'modelLine' }),
    el('p', { class: 'sub', text: 'Write the rules your model should follow, in plain text or Markdown. The model reads them before every answer and before every question→answer training pass. They start blank; whether a rule is followed is something you measure with rule tests after training.' }),
    el('textarea', { id: 'ruText', rows: '8', 'aria-label': 'Rules', placeholder: 'Enter your rules here. Nothing is prefilled.' }),
    el('p', { id: 'ruBytes', class: 'sub' }),
    el('div', { class: 'actions' },
      iconButton('check', 'Apply rules', { id: 'ruApply', class: 'primary' }), iconButton('book', 'Save draft', { id: 'ruDraft' }),
      iconButton('trash', 'Remove applied rules', { id: 'ruClear', class: 'danger' }), iconButton('export', 'Export .md', { id: 'ruExport' }),
      el('label', { class: 'inline' }, 'Import .md', el('input', { id: 'ruImport', type: 'file', accept: '.md,text/markdown,text/plain' }))),
    el('p', { id: 'ruStatus', role: 'status', hidden: true }),
    el('details', {}, el('summary', { text: 'Rules currently applied' }), el('pre', { id: 'ruApplied' })),
    el('details', {}, el('summary', { text: 'Rule tests' }),
      el('p', { class: 'sub', text: 'Add a fenced forge-test block to your rules with JSON [{ "name", "prompt", "expected" }]. Running it generates an answer for each prompt with the applied rules and compares it to what you expect. Nothing is trained by a test.' }),
      el('pre', { text: '```forge-test\n[{ "name": "units", "prompt": "What unit is bore measured in?", "expected": "millimetres" }]\n```' }),
      iconButton('run', 'Run rule tests', { id: 'ruTest' }), el('pre', { id: 'ruTestOut' })),
    el('details', {}, el('summary', { text: 'Draft history (this browser)' }), el('div', { class: 'row' }, el('select', { id: 'ruHistory', 'aria-label': 'Saved drafts' }), iconButton('import', 'Restore to editor', { id: 'ruRestore' })))));
// ---------- 3. Teach ----------
host.append(
  el('div', { class: 'card' }, h2('teach', 'Teach'),
    el('p', { class: 'sub', text: 'Type something and choose what to do with it: Teach saves it as a training example, Ask gets an answer, Correct turns your text into the right answer for the previous question. Green lines are model output or a saved weight change, not verified truth. Learning runs while this page or Chat is open.' }),
    el('div', { id: 'ctLog', class: 'convo', 'aria-live': 'polite', 'aria-label': 'Training conversation' }),
    el('form', { id: 'ctForm' },
      el('div', { class: 'composerBox' }, el('textarea', { id: 'ctText', rows: '3', 'aria-label': 'Teaching text or question', placeholder: 'Teach, ask, or upload text and Markdown' }),
        iconButton('upload', 'Upload', { id: 'ctUpload' }), el('input', { id: 'ctFiles', type: 'file', multiple: true, hidden: true, accept: '.txt,.md,.json,.csv,.yaml,.yml,.js,.py,.log' })),
      el('div', { class: 'actions' }, iconButton('teach', 'Teach', { type: 'submit', value: 'learn', class: 'primary' }), iconButton('ask', 'Ask', { type: 'submit', value: 'ask' }), iconButton('correct', 'Correct previous answer', { type: 'submit', value: 'correct' }))),
    el('div', { class: 'row', style: 'margin-top:14px' },
      el('label', { class: 'inline' }, el('input', { id: 'ctAuto', type: 'checkbox', checked: true }), 'Learn from my messages and uploads automatically'),
      iconButton('pause', 'Pause learning', { id: 'ctPause', class: 'quiet' }), iconButton('resume', 'Resume learning', { id: 'ctResume', class: 'quiet' })),
    el('details', {}, el('summary', { text: 'Question → answer examples and limits' }),
      el('p', { class: 'sub', text: 'Plain text and Markdown train next-byte prediction of the document. For question → answer training, include a fenced forge-example block with JSON {prompt, response}; such pairs are trained until the model reproduces the answer (or passes run out). A Markdown file with a forge-tool block is a skill: its text is learned here, but the tool is only installed from the Skills page after you review the code.' }),
      el('pre', { text: '```forge-example\n' + JSON.stringify({ prompt: 'What is 9+9?', response: '18' }, null, 2) + '\n```' }),
      el('p', { class: 'sub', text: 'Limits: 3 files per upload, 65,536 bytes combined; 500 saved examples and 2 MiB per model; 25 examples per submission. Nothing is truncated silently. Reproducing a training example is not generalisation; test with new questions.' }))));
// ---------- 4. Evidence ----------
host.append(
  el('details', {}, el('summary', {}, 'Evidence and export'),
    el('div', { class: 'row' }, iconButton('folder', 'Show saved learning evidence', { id: 'ctAudit' }), iconButton('run', 'Re-test trained examples', { id: 'ctEval' }), iconButton('export', 'Export weights + history', { id: 'ctExport' })),
    el('pre', { id: 'ctAuditOutput', class: 'codeBox' }),
    el('p', { class: 'sub', text: 'Export writes weights, rules, learning history and receipts to a JSON file you can import on another device. Otherwise everything lives in this browser’s storage; clearing site data deletes it.' })));

// ================= model section logic =================
const mStatus = (t, tone) => setStatus($('mbStatus'), t, tone);
function chosenH() { const v = $('mbH').value; const h = v === 'custom' ? Number($('mbCustom').value) : Number(v); if (!Number.isInteger(h) || h < MIN_H || h > MAX_H) throw Error(`Hidden size must be an integer from ${MIN_H} to ${MAX_H}`); return h; }
function describeSize() {
  for (const b of sizePick.children) b.setAttribute('aria-pressed', String(b.dataset.h === $('mbH').value));
  try { const h = chosenH(); $('mbParams').textContent = `Hidden size ${h}: ${fmt(parameterCount(h))} parameters (2·256·H + H² + H + 256), about ${fmt(Math.round(parameterCount(h) * 4 / 1024))} KiB of weights.`; } catch (e) { $('mbParams').textContent = e.message; }
}
$('mbH').onchange = () => { $('mbCustomLabel').hidden = $('mbH').value !== 'custom'; describeSize(); }; $('mbCustom').oninput = describeSize; describeSize();
let mBusy = false;
async function mAct(fn) { if (mBusy) return; mBusy = true; try { await fn(); } catch (e) { mStatus(e.message, 'error'); } finally { mBusy = false; await renderList(); } }
$('mbBench').onclick = () => mAct(async () => {
  const H = chosenH(); mStatus(`Measuring hidden size ${H}… the page may be unresponsive for a moment.`, 'caution');
  const b = await service.benchmark(H);
  const perExample = b.updateMs * 2 + b.readMsPerByte * 64;
  mStatus(`Hidden size ${H} on this device: one weight update ≈ ${b.updateMs.toFixed(0)} ms; reading text ≈ ${b.readMsPerByte.toFixed(2)} ms per byte; a typical short chat message ≈ ${(perExample / 1000).toFixed(1)} s of training. Rules of 2,000 bytes add ≈ ${(b.readMsPerByte * 2000 / 1000).toFixed(1)} s each time they are re-read.`, perExample > 3000 ? 'caution' : 'ok');
});
$('mbCreate').onclick = () => mAct(async () => {
  const id = $('mbId').value.trim(), H = chosenH(), seedRaw = $('mbSeed').value.trim();
  const seed = seedRaw === '' ? undefined : Number(seedRaw); if (seed !== undefined && !Number.isInteger(seed)) throw Error('Seed must be an integer');
  const s = await service.create(id, { H, seed });
  mStatus(`Created and saved ${s.modelId}: hidden size ${s.H}, ${fmt(s.parameterCount)} randomly initialised parameters, 0 updates, no rules, no skills. It is now the active model for Chat and Train.`, 'ok');
  $('mbId').value = '';
});
$('mbImport').onchange = e => mAct(async () => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  const id = $('mbId').value.trim(); if (!id) throw Error('Enter the name to save the import under (Create a new model → Name)');
  if (f.size > 96 * 1024 * 1024) throw Error('Checkpoint exceeds 96 MiB');
  let checkpoint; try { checkpoint = JSON.parse(await f.text()); } catch { throw Error('Checkpoint is not valid JSON'); }
  const s = await service.create(id, { checkpoint });
  mStatus(`Imported ${f.name} as ${s.modelId}: ${fmt(s.parameterCount)} parameters, ${fmt(s.steps)} prior updates, ${s.examples} saved examples, rules ${fmt(s.rulesBytes)} bytes. Weights were verified finite; nothing else about their quality is known.`, 'ok');
  $('mbId').value = '';
});
let renderToken = 0;
async function renderList() {
  const token = ++renderToken, list = $('mbList');
  let models; try { models = await service.list(); } catch (e) { setStatus($('mbListStatus'), 'Could not read model storage: ' + e.message, 'error'); return; }
  if (token !== renderToken) return;
  list.replaceChildren();
  setStatus($('mbListStatus'), '', 'regular');
  $('mbCreateBox').open = $('mbCreateBox').open || !models.length;
  const active = service.activeId;
  for (const m of models) {
    const isActive = m.modelId === active;
    list.append(el('div', { class: 'item' },
      el('h3', {}, m.modelId, isActive && el('span', { class: 'badge', text: 'active' })),
      el('p', { class: 'sub', text: `hidden ${m.H} · ${fmt(m.parameterCount)} parameters · ${fmt(m.steps)} updates · ${m.examples ?? 0} saved examples · rules ${fmt(m.rulesBytes || 0)} bytes · updated ${new Date(m.updatedAt).toLocaleString()}` }),
      el('div', { class: 'row' },
        !isActive && iconButton('check', 'Use this model', { onclick: () => mAct(async () => { await service.select(m.modelId); mStatus(`${m.modelId} is now active.`, 'ok'); }) }),
        isActive && iconButton('export', 'Export', { onclick: () => mAct(async () => { const data = await service.export(); download(data, `${data.modelId}-checkpoint.json`); mStatus(`Export of ${data.modelId} requested (weights ${short(data.weightsHash)}). Browser-local copy remains.`, 'ok'); }) }),
        isActive && iconButton('chat', 'Open Chat', { onclick: () => showPage('chat') }),
        iconButton('trash', 'Delete', { class: 'danger', onclick: () => mAct(async () => { if (!confirm(`Delete model ${m.modelId}, its learning history and receipts from this browser? Export first if you want a copy. This cannot be undone.`)) return; await service.delete(m.modelId); mStatus(`Deleted ${m.modelId}.`, 'ok'); }) }))));
  }
}

// ================= rules section logic =================
const rStatus = (t, tone) => setStatus($('ruStatus'), t, tone);
let record = null, rBusy = false;
function bytesLine() { const n = enc.encode($('ruText').value).length; $('ruBytes').textContent = `${fmt(n)} of ${fmt(MAX_RULES_BYTES)} bytes`; $('ruBytes').dataset.tone = n > MAX_RULES_BYTES ? 'error' : n > MAX_RULES_BYTES * 0.8 ? 'caution' : 'regular'; }
$('ruText').addEventListener('input', bytesLine);
async function loadRules() {
  const s = await service.info();
  const controls = ['ruText', 'ruDraft', 'ruApply', 'ruClear', 'ruImport', 'ruExport', 'ruTest', 'ruRestore'];
  if (!s.exists) { record = null; for (const id of controls) $(id).disabled = true; setStatus($('ruModel'), 'No active model yet. Create one above, then write its rules here.', 'caution'); $('ruApplied').textContent = ''; return; }
  for (const id of controls) $(id).disabled = false;
  record = readRecord(localStorage, s.modelId) || createRecord(localStorage, s.modelId);
  if (document.activeElement !== $('ruText')) $('ruText').value = record.draft || '';
  bytesLine();
  const audit = await service.audit();
  setStatus($('ruModel'), `Model ${s.modelId} · applied rules ${fmt(s.rulesBytes)} bytes` + (audit.rulesHash ? ` (sha256 ${audit.rulesHash.slice(0, 12)})` : '') + ` · ${fmt(s.steps)} updates`, 'regular');
  $('ruApplied').textContent = audit.rules || 'No rules applied. The model answers without any rule context.';
  $('ruHistory').replaceChildren(...record.history.map((v, i) => el('option', { value: String(i), text: `${new Date(v.at).toLocaleString()} — ${fmt(enc.encode(v.rules).length)} bytes` })));
}
async function rAct(fn) { if (rBusy) return; rBusy = true; try { await fn(); } catch (e) { rStatus(e.message, 'error'); } finally { rBusy = false; await loadRules().catch(e => rStatus(e.message, 'error')); } }
$('ruDraft').onclick = () => rAct(() => { record = saveRecord(localStorage, record, $('ruText').value); rStatus('Draft saved in this browser (not applied to the model).', 'regular'); });
$('ruApply').onclick = () => rAct(async () => {
  const text = $('ruText').value;
  if (!text.trim() && !confirm('Apply empty rules? The model will answer without rule context.')) return;
  record = saveRecord(localStorage, record, text, true);
  const r = await service.setRules(text);
  rStatus(`Applied ${fmt(r.rulesBytes)} bytes of rules to ${r.modelId} (sha256 ${r.rulesHash ? r.rulesHash.slice(0, 12) : 'none'}); rules state computed in ${r.rulesMilliseconds ? r.rulesMilliseconds.toFixed(0) : 0} ms at update ${r.steps}. Every answer and every question→answer training pass now starts from this state.`, 'ok');
});
$('ruClear').onclick = () => rAct(async () => { if (!confirm('Remove the applied rules from this model? Your draft stays in the editor.')) return; const r = await service.setRules(''); rStatus(`Rules removed from ${r.modelId}.`, 'ok'); });
$('ruImport').onchange = e => rAct(async () => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (f.size > MAX_RULES_BYTES) throw Error(`File exceeds ${fmt(MAX_RULES_BYTES)} bytes`); $('ruText').value = await f.text(); bytesLine(); rStatus(`Loaded ${f.name} into the editor. Save or apply it.`, 'regular'); });
$('ruExport').onclick = () => { const url = URL.createObjectURL(new Blob([$('ruText').value], { type: 'text/markdown' })), a = document.createElement('a'); a.href = url; a.download = `${record?.modelId || 'model'}-rules.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
$('ruRestore').onclick = () => rAct(() => { const v = record.history[Number($('ruHistory').value)]; if (!v) throw Error('Select a version'); $('ruText').value = v.rules; bytesLine(); rStatus('Version restored to the editor; apply it to use it.', 'regular'); });
$('ruTest').onclick = () => rAct(async () => {
  const text = (await service.audit()).rules || '', cases = [];
  for (const m of text.matchAll(/^```forge-test\s*\n([\s\S]*?)^```\s*$/gm)) { let o; try { o = JSON.parse(m[1]); } catch { throw Error('forge-test block is not valid JSON'); } for (const c of Array.isArray(o) ? o : [o]) cases.push(c); }
  if (!cases.length) throw Error('No forge-test blocks in the applied rules');
  const r = await service.evaluate(cases);
  $('ruTestOut').textContent = `${r.exact}/${r.total} exact at update ${r.steps} with ${fmt(r.rules.bytes)} bytes of rules.\n\n` + r.results.map(x => `${x.exactMatch ? 'PASS' : 'FAIL'} ${x.name || ''}\n  prompt:   ${x.prompt}\n  expected: ${JSON.stringify(x.expected)}\n  actual:   ${JSON.stringify(x.actual)}  (byte accuracy ${(x.byteAccuracy * 100).toFixed(0)}%)`).join('\n');
  $('ruTestOut').dataset.tone = r.exact === r.total ? 'ok' : 'caution';
});

// ================= teach section logic =================
let tBusy = false, reading = false; const receipts = new Map();
function add(role, text) {
  const n = el('div', { class: 'm ' + (role === 'u' ? 'u' : role === 'a' ? 'a' : 's'), text: (role === 'u' ? 'You: ' : role === 'a' ? 'Model: ' : '') + text });
  n.dataset.tone = role === 'error' ? 'error' : role === 'a' || role === 'ok' ? 'ok' : role === 'u' ? 'regular' : 'caution';
  $('ctLog').append(n); n.scrollIntoView({ block: 'nearest' }); return n;
}
async function state() {
  const s = await service.info();
  $('ctAuto').checked = s.autoLearn !== false;
  setStatus($('ctModelState'), !s.exists ? 'No active model. Create one below; Chat and Teach use whichever model is active.' : `Model ${s.modelId} · ${fmt(s.parameterCount)} parameters · ${fmt(s.steps)} weight updates · ${s.pending} queued example(s) · rules ${fmt(s.rulesBytes)} bytes · ${s.paused ? 'learning paused' : 'learning on'}`, s.exists ? 'regular' : 'caution');
}
async function tAct(fn) { if (tBusy || reading) { add('error', 'Wait for the current operation.'); return; } tBusy = true; try { await fn(); } catch (e) { add('error', e.message); } finally { tBusy = false; await state().catch(() => {}); } }
service.addEventListener('receipt', ({ detail: r }) => { const prior = receipts.get(r.jobId), n = add('ok', receiptText(r)); if (prior) prior.replaceWith(n); receipts.set(r.jobId, n); state().catch(() => {}); });
service.addEventListener('queued', ({ detail: r }) => add('s', `${fmt(r.bytes)} bytes saved as ${r.jobIds.length} example(s) for ${r.modelId}. Queued is not learned; the green receipt confirms the weight change.`));
service.addEventListener('error', ({ detail }) => add('error', detail.message));
service.addEventListener('consolidation', ({ detail: c }) => add(c.requeued.length ? 's' : 'ok', `Consolidation check at update ${c.step}: ${c.reproduced}/${c.tested} trained question/answer pairs still reproduced` + (c.rules.bytes ? ` with ${fmt(c.rules.bytes)} bytes of rules` : '') + (c.requeued.length ? `; re-queued ${c.requeued.length} that drifted: ${[...new Set(c.requeued)].join(', ')}.` : '.')));
service.addEventListener('notice', ({ detail }) => add('s', detail.message));
$('ctPause').onclick = () => tAct(async () => { await service.call('pause'); add('s', 'Learning paused; queued examples wait.'); });
$('ctResume').onclick = () => tAct(async () => { await service.call('resume'); add('s', 'Learning resumed.'); });
$('ctAuto').onchange = e => tAct(() => service.call('auto', { enabled: e.target.checked }));
$('ctExport').onclick = () => tAct(async () => { const data = await service.export(); download(data, `${data.modelId}-checkpoint.json`); add('ok', 'Checkpoint download requested. Browser-local weights remain saved.'); });
$('ctAudit').onclick = () => tAct(async () => { $('ctAuditOutput').textContent = JSON.stringify(await service.audit(), null, 2); });
$('ctEval').onclick = () => tAct(async () => {
  const audit = await service.audit(), pairs = audit.jobs.filter(j => j.kind === 'pair');
  if (!pairs.length) throw Error('No question/answer examples saved for this model yet.');
  const full = await service.export(); const dec = new TextDecoder();
  const cases = full.learning.jobs.filter(j => j.kind === 'pair').slice(0, 200).map(j => { const t = new Uint8Array(j.tokens); return { name: j.name, prompt: dec.decode(t.slice(0, j.responseStart)).slice(6, -8), expected: dec.decode(t.slice(j.responseStart, -1)) }; });
  const r = await service.evaluate(cases);
  $('ctAuditOutput').textContent = `Re-test of ${r.total} trained example(s) at update ${r.steps} (weights ${r.weightsHash.slice(0, 12)}, rules ${r.rules.bytes} bytes): ${r.exact} exact.\nThese are the training prompts themselves — reproduction, not generalisation.\n\n` + r.results.map(x => `${x.exactMatch ? 'EXACT' : 'DIFF '} ${x.name}\n  prompt:   ${JSON.stringify(x.prompt)}\n  expected: ${JSON.stringify(x.expected)}\n  actual:   ${JSON.stringify(x.actual)}`).join('\n');
});
$('ctUpload').onclick = () => $('ctFiles').click();
$('ctFiles').onchange = async e => {
  if (tBusy || reading) return; reading = true;
  try { const files = await readTextFiles(e.target.files, { maxFiles: 3, maxTotalBytes: 65536 }); if (!files.length) return; add('u', 'Uploaded: ' + files.map(f => f.name).join(', ')); const r = await service.interact('', { files, learnOnly: true }); if (!r.queued) add('s', 'Nothing was queued (automatic learning is off and no examples were found).'); }
  catch (error) { add('error', error.message); } finally { reading = false; e.target.value = ''; }
};
$('ctForm').onsubmit = e => {
  e.preventDefault(); const kind = e.submitter?.value || 'ask', text = $('ctText').value.trim(); if (!text) return;
  tAct(async () => {
    add('u', (kind === 'learn' ? '[teach] ' : kind === 'correct' ? '[correction] ' : '') + text);
    const r = await service.interact(text, { learnOnly: kind === 'learn', correction: kind === 'correct' });
    if (kind === 'ask') { if (r.feedbackOnly) add('s', 'Negative feedback recorded as text. Enter the correct answer and press Correct previous answer.'); else add('a', r.text || '(empty response)'); if (r.text !== undefined) add('s', `Generated at update ${r.steps}${r.rules?.bytes ? ` with ${fmt(r.rules.bytes)} bytes of rules (state from update ${r.rules.stateStep})` : ', no rules assigned'}. Generation changes no weights.`); }
    $('ctText').value = '';
  });
};

// ================= refresh =================
async function refreshAll() { await Promise.all([renderList(), loadRules().catch(e => rStatus(e.message, 'error')), state().catch(e => add('error', e.message))]); }
service.addEventListener('selected', refreshAll);
service.addEventListener('rules', () => { loadRules().catch(() => {}); state().catch(() => {}); });
document.addEventListener('forge:page', ({ detail }) => { if (detail.page === 'train') refreshAll(); });
await service.ready.catch(() => {}); await refreshAll();
