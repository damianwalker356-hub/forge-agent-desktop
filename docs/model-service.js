// Main-thread facade over the learning worker. One active model at a time; the active ID is remembered locally.
import { describeFeedback, markdownExamples } from './learning-data.js';
import { createRecord, readRecord } from './model-records.js';
import { MAX_PROMPT_BYTES, promptText } from './rnn-core.js';
export const ACTIVE_KEY = 'forge-active-owned-model';
const encoder = new TextEncoder();
class ModelService extends EventTarget {
  constructor() {
    super(); this.sequence = 0; this.requests = new Map(); this.state = { exists: false }; this.lastQuestion = '';
    this.worker = new Worker(new URL('./learning-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.event) { if (data.event === 'receipt') this.state.steps = data.detail.stepAfter; this.dispatchEvent(new CustomEvent(data.event, { detail: data.detail })); return; }
      const entry = this.requests.get(data.id); if (!entry) return; this.requests.delete(data.id);
      data.error ? entry.reject(Error(data.error)) : entry.resolve(data.result);
    };
    this.worker.onerror = error => { for (const entry of this.requests.values()) entry.reject(Error(error.message || 'Model worker failed')); this.requests.clear(); this.dispatchEvent(new CustomEvent('error', { detail: { message: 'Model worker failed. Reload to restore the last committed checkpoint.' } })); };
    const active = localStorage.getItem(ACTIVE_KEY);
    this.ready = (active ? this.call('select', { modelId: active }) : Promise.resolve({ exists: false, modelId: null })).then(s => { this.state = s; this.dispatchEvent(new Event('selected')); return s; });
    this.ready.catch(() => {});
  }
  call(method, args = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => { this.requests.set(id, { resolve, reject }); this.worker.postMessage({ id, method, args }); });
  }
  get activeId() { return this.state?.exists ? this.state.modelId : null; }
  async list() { await this.ready; return this.call('list'); }
  async select(modelId) {
    await this.ready; const state = await this.call('select', { modelId });
    if (!state.exists) throw Error(`No model named ${modelId} is stored in this browser`);
    this.state = state; this.lastQuestion = ''; localStorage.setItem(ACTIVE_KEY, modelId); this.dispatchEvent(new Event('selected')); return state;
  }
  // Create an empty (randomly initialised) model of hidden size H, or import an exported checkpoint under a new ID.
  async create(modelId, { H, seed, checkpoint, rules } = {}) {
    await this.ready;
    const state = await this.call('create', { modelId, H, seed, checkpoint, rules });
    this.state = state; this.lastQuestion = ''; localStorage.setItem(ACTIVE_KEY, modelId);
    if (!readRecord(localStorage, modelId)) createRecord(localStorage, modelId); // Blank owner-authored rules draft; nothing prefilled.
    this.dispatchEvent(new Event('selected')); return state;
  }
  async delete(modelId) {
    await this.ready; const out = await this.call('delete', { modelId });
    if (this.state?.modelId === modelId) { this.state = { exists: false, modelId: null }; localStorage.removeItem(ACTIVE_KEY); this.dispatchEvent(new Event('selected')); }
    return out;
  }
  async info() { await this.ready; if (!this.state.exists) return { exists: false, modelId: null }; const s = await this.call('info'); this.state = s; return s; }
  async benchmark(H) { await this.ready; return this.call('benchmark', { H }); }
  async enqueue(examples) { await this.ready; return this.call('enqueue', { examples }); }
  async setRules(text) { await this.ready; const s = await this.call('rules', { text }); this.state = { ...this.state, ...s }; this.dispatchEvent(new CustomEvent('rules', { detail: s })); return s; }
  async evaluate(cases) { await this.ready; return this.call('evaluate', { cases }); }
  async export() { await this.ready; return this.call('export'); }
  async audit() { await this.ready; return this.call('audit'); }
  requireModel() { if (!this.state.exists) throw Error('No model is active. Create one on the Train page (or import an exported checkpoint there); nothing is prebuilt.'); }
  // Chat/trainer entry point. Every user text and upload is queued as learning data when auto-learn is on (or learnOnly).
  // Prediction never updates weights; the queued training runs separately and reports receipts.
  async interact(text, { files = [], learnOnly = false, correction = false, length = 120 } = {}) {
    await this.ready; this.requireModel();
    if (!learnOnly && !correction && text.trim() && encoder.encode(promptText(text)).length > MAX_PROMPT_BYTES) throw Error(`Question exceeds the model's ${MAX_PROMPT_BYTES.toLocaleString()}-byte prompt limit; use Learn from this for long text. Nothing truncated.`);
    const auto = (await this.call('info')).autoLearn, examples = [], notes = [];
    if (correction) {
      if (!this.lastQuestion) throw Error('Ask a question first so the correction has a target.');
      examples.push({ kind: 'pair', prompt: this.lastQuestion, response: text, name: 'User correction', passes: 150 });
    } else if (text.trim() && (auto || learnOnly)) {
      if (describeFeedback(text)) notes.push('Negative feedback recorded as user text, not as a correct answer. Use “Correct previous answer” and enter the actual answer to supervise that question.');
      examples.push({ text, kind: 'text', name: learnOnly ? 'User teaching text' : 'User message', passes: learnOnly ? 5 : 1 });
    }
    const skillFiles = [];
    for (const file of files) {
      const isSkill = /\.md$/i.test(file.name) && /^```forge-tool/m.test(file.text);
      if (isSkill) skillFiles.push(file);
      if (!(auto || learnOnly)) continue;
      examples.push({ kind: 'text', text: file.text, name: file.name, passes: 3 });
      if (/\.md$/i.test(file.name)) for (const pair of markdownExamples(file.text)) examples.push({ ...pair, kind: 'pair', name: file.name + ' example', passes: 150 });
    }
    if (skillFiles.length) { notes.push(`${skillFiles.length} file(s) contain a forge-tool block. Text and examples were queued for learning; the tool itself is only installed from the Skills page after you review the code.`); this.dispatchEvent(new CustomEvent('skill-files', { detail: { files: skillFiles } })); }
    for (const message of notes) this.dispatchEvent(new CustomEvent('notice', { detail: { message } }));
    let queued = null;
    if (examples.length) queued = await this.enqueue(examples);
    if (learnOnly || correction) return { queued: examples.length, jobIds: queued?.jobIds || [], text: '' };
    if (!text.trim()) return { queued: examples.length, jobIds: queued?.jobIds || [], text: '', attachmentOnly: true };
    if (describeFeedback(text)) return { feedbackOnly: true, text: '', queued: examples.length };
    this.lastQuestion = text;
    const generated = await this.call('generate', { text, length });
    return { ...generated, queued: examples.length, jobIds: queued?.jobIds || [] };
  }
}
export const modelService = new ModelService();
