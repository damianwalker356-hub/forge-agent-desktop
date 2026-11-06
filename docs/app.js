// Chat page and application bootstrap. The only language model here is the one the owner built on the Train page.
import { Memory, IDBBackend } from './memory.js';
import { Agent } from './agent.js';
import { createTools } from './tools.js';
import { MockLLM } from './llm.js';
import { modelService } from './model-service.js';
import { skillRegistry, parseToolCall } from './skill-registry.js';
import { SEED } from './seed.js';
import { takeSubmission, showPage } from './ui.js';
import { $, el, fmt, short, receiptText } from './page-utils.js';
const params = new URLSearchParams(location.search), mock = params.has('mock'), log = $('log'), input = $('t');
function add(cls, text, tone) { const d = el('div', { class: 'm ' + cls, text }); if (tone) d.dataset.tone = tone; log.append(d); $('screenChat').classList.add('chat-started'); log.scrollTop = log.scrollHeight; return d; }
const session = localStorage.getItem('forge_session') || crypto.randomUUID(); localStorage.setItem('forge_session', session);
const mem = await new Memory(new IDBBackend(mock ? 'forge-agent-mock' : 'forge-agent')).init(); mem.importSeed(SEED);
const tools = createTools({ getProxy: () => localStorage.getItem('forge_proxy') || '' });
const agent = new Agent(mem, mock ? new MockLLM() : null, tools);
agent.settings = { getProxy: () => localStorage.getItem('forge_proxy') || '', setProxy: v => localStorage.setItem('forge_proxy', v) };
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
async function modelLine() {
  const s = await modelService.info().catch(e => ({ exists: false, error: e.message }));
  const n = $('chatModel');
  if (!s.exists) { n.textContent = 'No model yet. Open Train to create your own; nothing is downloaded or prebuilt.'; n.dataset.tone = 'caution'; return; }
  n.textContent = `Model ${s.modelId} · ${fmt(s.parameterCount)} parameters · ${fmt(s.steps)} weight updates · rules ${fmt(s.rulesBytes)} bytes · ${s.pending} queued · ${s.paused ? 'learning paused' : 'learning on'}`;
  n.dataset.tone = 'regular';
}
modelService.addEventListener('selected', modelLine);
modelService.addEventListener('rules', modelLine);
modelService.addEventListener('receipt', ({ detail: r }) => { if (!$('screenChat').hidden) add('s', receiptText(r), 'ok'); modelLine(); });
modelService.addEventListener('queued', ({ detail: q }) => { if (!$('screenChat').hidden) add('s', `${fmt(q.bytes)} bytes saved as ${q.jobIds.length} learning example(s) for ${q.modelId}. Queued is not learned; a green receipt confirms a weight change.`, 'caution'); modelLine(); });
modelService.addEventListener('notice', ({ detail }) => { if (!$('screenChat').hidden) add('s', detail.message, 'caution'); });
modelService.addEventListener('error', ({ detail }) => add('s', 'Learning error: ' + detail.message, 'error'));
modelService.addEventListener('consolidation', ({ detail: c }) => { if (!$('screenChat').hidden) add('s', `Consolidation: ${c.reproduced}/${c.tested} trained pairs reproduced at update ${c.step}` + (c.requeued.length ? `; ${c.requeued.length} re-queued.` : '.'), c.requeued.length ? 'caution' : 'ok'); });
function describeToolOutcome(out) {
  if (!out.ok) return { text: `Tool ${out.tool} did not run: ${out.error}`, tone: 'error' };
  const body = out.rendered ? out.rendered + '\n' + JSON.stringify(out.result) : JSON.stringify(out.result, null, 2);
  return { text: `Tool ${out.tool} (skill ${out.skill}) ran in the sandbox (${out.mode}, ${out.milliseconds.toFixed(0)} ms) with input ${JSON.stringify(out.input)}:\n${body}` + (out.logs?.length ? '\nlogs: ' + out.logs.join(' | ') : ''), tone: 'ok' };
}
async function runToolCall(call) {
  if (call.error) { add('s', `The model's tool call could not be parsed: ${call.error}`, 'error'); return; }
  const out = await skillRegistry.callTool(call.name, call.input);
  const d = describeToolOutcome(out); add('s', d.text, d.tone);
}
async function send(message, files = []) {
  showPage('chat');
  add('u', message + (files.length ? '\nAttachments: ' + files.map(f => f.name).join(', ') : ''));
  const bubble = add('s', 'Working…', 'caution');
  try {
    if (message.startsWith('/tool ')) {
      const m = /^\/tool\s+([a-z0-9][a-z0-9_-]*)\s*(\{[\s\S]*\})?\s*$/.exec(message);
      if (!m) throw Error('Usage: /tool tool_name {"field": value}');
      const out = await skillRegistry.callTool(m[1], m[2] ? JSON.parse(m[2]) : {});
      const d = describeToolOutcome(out); bubble.textContent = d.text; bubble.dataset.tone = d.tone; return;
    }
    if (message === '/skills') {
      const t = skillRegistry.enabledTools();
      bubble.textContent = t.length ? 'Installed tools:\n' + t.map(x => `${x.tool} — ${x.description || 'no description'} — fields: ${Object.keys(x.schema).join(', ') || 'none'}`).join('\n') + '\nCall one with /tool name {json}; a model learns to call them from the examples you queue on the Skills page.' : 'No skills installed. Upload a Markdown skill on the Skills page.';
      bubble.dataset.tone = 'regular'; return;
    }
    if (mock || message.startsWith('/')) {
      const r = await agent.run(session, message, partial => { bubble.className = 'm a'; bubble.textContent = partial; });
      bubble.className = 'm a'; bubble.textContent = r.answer || '(no answer)'; delete bubble.dataset.tone;
      const used = (r.trace || []).filter(x => x.startsWith('tool:')); if (used.length) add('s', 'Memory tools: ' + used.join(', '));
      return;
    }
    const out = await modelService.interact(message, { files });
    if (out.attachmentOnly) { bubble.textContent = `Attachment(s) stored for learning (${out.queued} example(s)).`; bubble.dataset.tone = 'caution'; return; }
    if (out.feedbackOnly) { bubble.textContent = 'Negative feedback recorded as text. To supervise the previous answer, use “Correct previous answer” on the Train page and enter the actual answer.'; bubble.dataset.tone = 'caution'; return; }
    bubble.className = 'm a'; delete bubble.dataset.tone;
    bubble.textContent = out.text || '(empty response — the model has not learned to answer this yet)';
    const meta = `Generated by ${out.modelId} at update ${out.steps} (weights ${short(out.weightsHash)}) in ${out.milliseconds.toFixed(0)} ms` + (out.rules.bytes ? `, conditioned on ${fmt(out.rules.bytes)} bytes of your rules (state from update ${out.rules.stateStep})` : ', no rules assigned') + '. Generation changes no weights.';
    add('s', meta, 'regular');
    const call = parseToolCall(out.text); if (call) await runToolCall(call);
  } catch (e) { bubble.className = 'm s'; bubble.textContent = 'Error: ' + e.message; bubble.dataset.tone = 'error'; }
}
$('f').onsubmit = e => { e.preventDefault(); const s = takeSubmission(input.value); if (!s) return; input.value = ''; input.dispatchEvent(new Event('input')); send(s.message, s.files); };
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && innerWidth > 700) { e.preventDefault(); $('f').requestSubmit(); } });
$('mem').onclick = () => send('/memory'); $('help').onclick = () => send('/help');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__forge = { mem, agent, modelService, skillRegistry };
await modelService.ready.catch(() => {}); modelLine();
// Pages load after the chat shell so a failure in one page never blocks chat.
for (const [page, host] of [['./train-page.js', 'trainPage'], ['./forge-page.js', 'forgePage'], ['./skills-page.js', 'skillsPage'], ['./tutorial-page.js', 'tutorialPage'], ['./math-lab.js', 'tutorialMath']]) {
  try { await import(page); } catch (e) { $(host).append(el('p', { dataset: { tone: 'error' }, text: `This page failed to load: ${e.message}` })); }
}
