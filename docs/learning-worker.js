// Dedicated worker that owns one model at a time: weights, dataset queue, rules state and all training.
// Nothing here loads a pretrained model or contacts a server.
import { RNN, MAX_RULES_BYTES, encoder } from './rnn-core.js';
import { makeJob, nextWindow, advance } from './learning-data.js';
import { openStore, readModel, commitModel, validId, listModels, deleteModel } from './learning-store.js';
const RULES_REFRESH_STEPS = 16; // rules hidden state is recomputed when rules change or after this many weight updates
let db, record = null, net = null, running = false, paused = false, timer = null, replay = null, replayCursor = 0;
let rulesCache = null; // { hash, step, state }
const reply = (id, result) => postMessage({ id, result });
const emit = (type, detail) => postMessage({ event: type, detail });
let commands = Promise.resolve();
self.onmessage = ({ data }) => {
  commands = commands.then(async () => {
    try { reply(data.id, await handle(data.method, data.args || {})); }
    catch (error) { postMessage({ id: data.id, error: error.message }); }
  });
};
async function sha(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
async function save() {
  const candidate = { ...record, checkpoint: net.checkpoint(), updatedAt: new Date().toISOString() };
  const revision = await commitModel(db, candidate, record.revision);
  record = { ...candidate, revision };
}
// Hidden state after reading the model's rules with the current weights. Cached because a full pass over
// several kilobytes costs seconds on a phone; staleness is bounded and reported.
async function rulesState({ force = false } = {}) {
  const text = record.rules || '';
  if (!text) { rulesCache = null; return { state: null, bytes: 0, step: net.steps, hash: null, recomputed: false }; }
  const hash = await sha(text);
  const stale = !rulesCache || rulesCache.hash !== hash || force || net.steps - rulesCache.step >= RULES_REFRESH_STEPS;
  if (stale) {
    const started = performance.now();
    const state = net.warm(encoder.encode(text + '\n'));
    rulesCache = { hash, step: net.steps, state, milliseconds: performance.now() - started, bytes: encoder.encode(text).length };
  }
  return { state: rulesCache.state, bytes: rulesCache.bytes, step: rulesCache.step, hash, recomputed: stale, milliseconds: rulesCache.milliseconds };
}
function info() {
  return { modelId: record?.modelId, exists: Boolean(record), H: net?.H, steps: net?.steps || 0, parameterCount: net?.parameterCount || 0, revision: record?.revision,
    pending: record?.jobs.filter(j => j.status !== 'trained').length || 0, examples: record?.jobs.length || 0, paused, running,
    autoLearn: record?.autoLearn ?? true, rulesBytes: record?.rules ? encoder.encode(record.rules).length : 0, rulesStateStep: rulesCache?.step ?? null,
    lastReceipt: record?.receipts.at(-1) || null, createdAt: record?.createdAt, updatedAt: record?.updatedAt };
}
let batchCounter = 0, consolidationDue = false;
function schedule() {
  if (timer || running || paused || !net) return;
  const pending = record?.jobs.some(j => j.status !== 'trained');
  if (!pending && !consolidationDue) return;
  timer = setTimeout(() => { timer = null; commands = commands.then(pending ? runBatch : consolidate).catch(error => { paused = true; emit('error', { message: error.message }); }); }, 10);
}
// When the queue drains, re-test every trained question/answer pair with the current weights and rules. Pairs the
// model no longer reproduces are re-queued (bounded by MAX_REQUEUES) so later examples cannot silently erase earlier ones.
const MAX_REQUEUES = 3;
async function consolidate() {
  consolidationDue = false;
  if (paused || !net) return;
  const pairs = record.jobs.filter(j => j.kind === 'pair' && j.status === 'trained');
  if (!pairs.length) return;
  const rules = await rulesState({ force: true }), dec = new TextDecoder(), requeued = [], kept = [];
  for (const job of pairs) {
    if (job.responseStart > 2048 || job.tokens.length - job.responseStart > 512) continue;
    const question = dec.decode(job.tokens.slice(0, job.responseStart)).slice(6, -8), expected = dec.decode(job.tokens.slice(job.responseStart, -1));
    const actual = net.generate(question, Math.min(512, job.tokens.length - job.responseStart + 8), { initial: rules.state });
    if (actual === expected) { kept.push(job.name); continue; }
    if ((job.requeues || 0) >= MAX_REQUEUES) { job.stopReason = `Not reproduced after ${MAX_REQUEUES} consolidation re-queues; needs more capacity, passes or fewer conflicting examples`; continue; }
    job.requeues = (job.requeues || 0) + 1; job.status = 'queued'; job.pass = 0; job.cursor = job.responseStart; job.passes = Math.min(200, Math.max(20, Math.round(job.passes / 2))); job.stopReason = null;
    requeued.push(job.name);
  }
  await save();
  emit('consolidation', { modelId: record.modelId, tested: pairs.length, reproduced: kept.length, requeued, rules: { bytes: rules.bytes, stateStep: rules.step }, step: net.steps, saved: true });
  if (requeued.length) { consolidationDue = true; schedule(); }
}
async function runBatch() {
  if (paused || !net) return;
  const pending = record.jobs.filter(j => j.status !== 'trained'); if (!pending.length) return;
  const job = pending[batchCounter++ % pending.length]; // round-robin so no example monopolises the weights
  running = true;
  const before = net.checkpoint(), jobsBefore = structuredClone(record.jobs), receiptsBefore = record.receipts.slice();
  try {
    let changedParameters = 0, deltaL2 = 0, targets = 0, updates = 0, firstLoss = null, lastLoss = null; const windows = [];
    const hashBefore = await net.fingerprint(), stepBefore = net.steps;
    const start = performance.now();
    const rules = await rulesState(); // cached; used for pair training and pair replay
    for (let n = 0; n < 2 && job.status !== 'trained'; n++) {
      const window = nextWindow(job), initial = net.warm(window.warm, rules.state);
      const result = net.train(window.tokens, { initial, learningRate: job.kind === 'pair' ? 0.1 : 0.05 });
      firstLoss ??= result.lossBefore; lastLoss = result.lossAfter; updates++; targets += result.targets;
      windows.push({ lossBefore: result.lossBefore, lossAfter: result.lossAfter, targets: result.targets, step: result.step, gradientNorm: result.gradientNorm });
      changedParameters += result.changedParameters; deltaL2 += result.deltaL2;
      advance(job, window);
    }
    let replayUpdates = 0;
    // One replay window per batch from an already-trained example; mitigates (does not eliminate) forgetting.
    if (!replay && batchCounter % 3 === 0) {
      const older = record.jobs.filter(j => j.id !== job.id && j.status === 'trained');
      if (older.length) { const source = older[replayCursor++ % older.length]; replay = { ...source, tokens: source.tokens, pass: 0, cursor: source.responseStart, passes: 1, status: 'queued' }; }
    }
    if (replay) {
      const window = nextWindow(replay), initial = net.warm(window.warm, replay.kind === 'pair' ? rules.state : null);
      const result = net.train(window.tokens, { initial });
      changedParameters += result.changedParameters; deltaL2 += result.deltaL2; replayUpdates = 1; advance(replay, window);
      if (replay.status === 'trained') replay = null;
    }
    let reproduction = null;
    if (job.kind === 'pair') {
      const prefix = new TextDecoder().decode(job.tokens.slice(0, job.responseStart));
      const question = prefix.slice(6, -8);
      const expected = new TextDecoder().decode(job.tokens.slice(job.responseStart, -1));
      if (job.responseStart <= 2048 && job.tokens.length - job.responseStart <= 512) {
        const fresh = await rulesState({ force: true });
        const actual = net.generate(question, Math.min(512, job.tokens.length - job.responseStart + 8), { initial: fresh.state });
        reproduction = { expected, actual, exactMatch: actual === expected, scope: 'training-example reproduction; not a held-out test' };
        if (reproduction.exactMatch) { job.status = 'trained'; job.stopReason = 'Exact training-example reproduction measured'; }
      }
    }
    const receipt = { reproduction, id: crypto.randomUUID(), jobId: job.id, modelId: record.modelId, name: job.name, kind: job.kind,
      stepBefore, stepAfter: net.steps, updates, replayUpdates, targets, changedParameterAssignments: changedParameters,
      sumUpdateL2: deltaL2, lossBefore: firstLoss, lossAfter: lastLoss, comparableLosses: updates === 1 && !replayUpdates, windows,
      rules: job.kind === 'pair' ? { bytes: rules.bytes, stateStep: rules.step } : null,
      hashBefore, hashAfter: await net.fingerprint(), pass: job.pass, passes: job.passes, status: job.status, stopReason: job.stopReason || null,
      milliseconds: performance.now() - start, at: new Date().toISOString() };
    if (job.kind === 'pair' && job.status === 'trained') consolidationDue = true;
    record.receipts = [...record.receipts, receipt].slice(-100);
    await save(); // A success receipt is not emitted until IndexedDB commits.
    emit('receipt', { ...receipt, saved: true, revision: record.revision, pending: info().pending });
  } catch (error) {
    net = RNN.restore(before); record.jobs = jobsBefore; record.receipts = receiptsBefore; replay = null; paused = true; rulesCache = null;
    throw Error('Learning batch rolled back: ' + error.message);
  } finally { running = false; }
  schedule();
}
function validateLearning(learning) {
  if (!learning) return { jobs: [], receipts: [] };
  if (!Array.isArray(learning.jobs) || learning.jobs.length > 500 || !Array.isArray(learning.receipts) || learning.receipts.length > 100) throw Error('Invalid saved learning history');
  const jobs = learning.jobs.map(job => {
    if (!job || !Array.isArray(job.tokens) || job.tokens.length < 2 || job.tokens.length > 131072 || !job.tokens.every(x => Number.isInteger(x) && x >= 0 && x <= 255) || !['queued', 'trained'].includes(job.status) || !Number.isInteger(job.responseStart) || job.responseStart < 1 || job.responseStart >= job.tokens.length || !Number.isInteger(job.cursor) || job.cursor < job.responseStart || job.cursor >= job.tokens.length || !Number.isInteger(job.passes) || job.passes < 1 || job.passes > 200 || !Number.isInteger(job.pass) || job.pass < 0 || job.pass > job.passes || !Number.isSafeInteger(job.updates) || job.updates < 0 || !['text', 'pair'].includes(job.kind)) throw Error('Invalid saved training job');
    return { ...job, tokens: new Uint8Array(job.tokens) };
  });
  if (jobs.reduce((sum, j) => sum + j.tokens.length, 0) > 2 * 1024 * 1024) throw Error('Saved dataset exceeds 2 MiB');
  return { jobs, receipts: learning.receipts };
}
function validRules(text) {
  if (typeof text !== 'string') throw Error('Rules must be text');
  if (encoder.encode(text).length > MAX_RULES_BYTES) throw Error(`Rules exceed the model context limit of ${MAX_RULES_BYTES.toLocaleString()} UTF-8 bytes; nothing truncated. Shorten the rules or split guidance into skills.`);
  return text;
}
async function handle(method, args) {
  db ||= await openStore();
  if (method === 'list') return listModels(db);
  if (method === 'select') {
    const id = validId(args.modelId), stored = await readModel(db, id);
    if (!stored) { net = null; record = null; paused = false; rulesCache = null; return { modelId: id, exists: false }; }
    net = RNN.restore(stored.checkpoint); record = { rules: '', ...stored }; paused = false; replay = null; rulesCache = null; consolidationDue = record.jobs.some(j => j.kind === 'pair' && j.status === 'trained');
    schedule(); return { ...info(), exists: true };
  }
  if (method === 'create') {
    const id = validId(args.modelId);
    if (await readModel(db, id)) throw Error('Model exists. Load it instead of overwriting it.');
    const H = args.checkpoint ? undefined : (args.H ?? 800);
    const candidate = args.checkpoint ? RNN.restore(args.checkpoint) : new RNN({ H, seed: Number.isInteger(args.seed) ? args.seed : (crypto.getRandomValues(new Uint32Array(1))[0] || 1) });
    const now = new Date().toISOString();
    const { jobs, receipts } = validateLearning(args.checkpoint?.learning);
    const rules = validRules(typeof args.rules === 'string' ? args.rules : (typeof args.checkpoint?.rules === 'string' ? args.checkpoint.rules : ''));
    const next = { modelId: id, schemaVersion: 2, revision: -1, createdAt: now, updatedAt: now, autoLearn: args.checkpoint?.learning?.autoLearn !== false, rules, jobs, receipts, checkpoint: candidate.checkpoint() };
    next.revision = await commitModel(db, next, -1); net = candidate; record = next; paused = false; replay = null; rulesCache = null;
    schedule(); return { ...info(), exists: true, saved: true };
  }
  if (method === 'delete') {
    const id = validId(args.modelId);
    const stored = await readModel(db, id); if (!stored) throw Error('No such model');
    await deleteModel(db, id, stored.revision);
    if (record?.modelId === id) { net = null; record = null; rulesCache = null; replay = null; }
    return { deleted: id, active: record?.modelId || null };
  }
  if (method === 'benchmark') {
    // Times one 32-byte training window and a 256-byte read on a throwaway network of the requested size, on this device.
    const probe = new RNN({ H: args.H ?? 800, seed: 1 }), bytes = new Uint8Array(256).map((_, i) => 32 + (i % 90));
    probe.train(bytes.slice(0, 33)); // warm-up (JIT)
    const t0 = performance.now(); const initial = probe.warm(bytes); const t1 = performance.now(); probe.train(bytes.slice(0, 33), { initial }); const t2 = performance.now();
    return { H: probe.H, parameterCount: probe.parameterCount, readMsPerByte: (t1 - t0) / 256, updateMs: t2 - t1 };
  }
  if (!net || !record) throw Error('Create or load a model first (Model builder). An exported checkpoint can be imported as a new model.');
  if (method === 'info') return info();
  if (method === 'auto') {
    const before = record.autoLearn; record.autoLearn = Boolean(args.enabled);
    try { await save(); } catch (error) { record.autoLearn = before; throw error; }
    return info();
  }
  if (method === 'rules') {
    const text = validRules(args.text), before = record.rules;
    record.rules = text; rulesCache = null;
    try { await save(); } catch (error) { record.rules = before; throw error; }
    const state = await rulesState({ force: true });
    return { ...info(), rulesHash: state.hash, rulesMilliseconds: state.milliseconds, saved: true };
  }
  if (method === 'enqueue') {
    const specifications = args.examples;
    if (!Array.isArray(specifications) || !specifications.length || specifications.length > 25) throw Error('Provide 1–25 learning examples per request');
    if (record.jobs.length + specifications.length > 500) throw Error('Model dataset limit: 500 examples. Export and curate; no automatic deletion.');
    const jobs = specifications.map(spec => makeJob({ ...spec, id: crypto.randomUUID() }));
    const total = [...record.jobs, ...jobs].reduce((sum, j) => sum + j.tokens.length, 0);
    if (total > 2 * 1024 * 1024) throw Error('Model dataset exceeds 2 MiB. Nothing dropped or truncated.');
    const prior = record.jobs; record.jobs = [...prior, ...jobs];
    try { await save(); } catch (error) { record.jobs = prior; throw error; }
    emit('queued', { modelId: record.modelId, jobIds: jobs.map(j => j.id), bytes: jobs.reduce((s, j) => s + j.tokens.length, 0), saved: true, pending: info().pending });
    schedule(); return { ...info(), jobIds: jobs.map(j => j.id), queued: true, saved: true };
  }
  if (method === 'pause') { paused = true; return info(); }
  if (method === 'resume') { paused = false; schedule(); return info(); }
  if (method === 'generate') {
    const steps = net.steps, weightsHash = await net.fingerprint(), rules = await rulesState({ force: Boolean(args.freshRules) });
    const started = performance.now();
    const text = net.generate(args.text, args.length || 80, { initial: rules.state });
    return { text, steps, weightsHash, modelId: record.modelId, trainingPerformed: false, rules: { bytes: rules.bytes, stateStep: rules.step, recomputed: rules.recomputed }, milliseconds: performance.now() - started };
  }
  if (method === 'evaluate') {
    // Held-out style check: generate for each prompt and compare with the expected response. Never trains.
    if (!Array.isArray(args.cases) || !args.cases.length || args.cases.length > 200) throw Error('Provide 1–200 evaluation cases');
    const rules = await rulesState({ force: true }), results = [];
    for (const c of args.cases) {
      if (typeof c.prompt !== 'string' || typeof c.expected !== 'string') throw Error('Each case needs prompt and expected strings');
      const actual = net.generate(c.prompt, Math.min(512, encoder.encode(c.expected).length + 16), { initial: rules.state });
      const a = encoder.encode(actual), e = encoder.encode(c.expected); let same = 0;
      for (let i = 0; i < Math.min(a.length, e.length); i++) if (a[i] === e[i]) same++;
      results.push({ prompt: c.prompt, expected: c.expected, actual, exactMatch: actual === c.expected, byteAccuracy: e.length ? same / Math.max(a.length, e.length) : 0, name: c.name || '' });
    }
    return { modelId: record.modelId, steps: net.steps, weightsHash: await net.fingerprint(), rules: { bytes: rules.bytes, stateStep: rules.step }, exact: results.filter(r => r.exactMatch).length, total: results.length, results };
  }
  if (method === 'export') {
    const checkpoint = net.checkpoint({ json: true });
    return { ...checkpoint, modelId: record.modelId, rules: record.rules || '', weightsHash: await net.fingerprint(), exportedAt: new Date().toISOString(), learning: { revision: record.revision, autoLearn: record.autoLearn, jobs: record.jobs.map(j => ({ ...j, tokens: Array.from(j.tokens) })), receipts: record.receipts } };
  }
  if (method === 'audit') return { ...info(), hash: await net.fingerprint(), rulesHash: record.rules ? await sha(record.rules) : null, rules: record.rules || '', jobs: record.jobs.map(j => ({ id: j.id, name: j.name, kind: j.kind, status: j.status, pass: j.pass, passes: j.passes, updates: j.updates, bytes: j.tokens.length })), receipts: record.receipts };
  throw Error('Unknown learning operation');
}
